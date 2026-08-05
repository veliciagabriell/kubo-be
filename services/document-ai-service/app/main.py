import asyncio
import base64
import binascii
import csv
import io
import os
import tempfile
from importlib.metadata import version
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MAX_FILE_BYTES = int(os.getenv("DOCUMENT_MAX_BYTES", str(25 * 1024 * 1024)))
SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".docx",
    ".xlsx",
    ".csv",
}


class ParseRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1)


class Block(BaseModel):
    text: str
    page: int | None = None
    bounding_box: list[float] | None = None


class ParseResponse(BaseModel):
    text: str
    pages: int
    has_text_layer: bool
    used_ocr: bool
    parser: str
    blocks: list[Block]


app = FastAPI(
    title="KUBO Document AI Service",
    version="1.0.0",
    description="Stateless Docling adapter for KUBO Document Intelligence.",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "document-ai-service",
        "docling_version": version("docling"),
    }


@app.post("/parse", response_model=ParseResponse)
async def parse_document(payload: ParseRequest) -> ParseResponse:
    extension = Path(payload.file_name).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Unsupported format: {extension}")

    try:
        content = base64.b64decode(payload.content_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="Invalid base64 content") from error

    if not content:
        raise HTTPException(status_code=400, detail="File is empty")
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds configured size limit")

    if extension == ".csv":
        return parse_csv(content)

    try:
        return await asyncio.to_thread(
            parse_with_docling,
            content,
            Path(payload.file_name).name,
            extension,
        )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=f"Document conversion failed: {error}",
        ) from error


def parse_csv(content: bytes) -> ParseResponse:
    text = content.decode("utf-8-sig", errors="replace")
    rows = list(csv.reader(io.StringIO(text)))
    normalized = "\n".join(", ".join(cell.strip() for cell in row) for row in rows)
    return ParseResponse(
        text=normalized,
        pages=1,
        has_text_layer=True,
        used_ocr=False,
        parser="native-csv",
        blocks=[Block(text=normalized, page=1)] if normalized else [],
    )


def parse_with_docling(
    content: bytes,
    file_name: str,
    extension: str,
) -> ParseResponse:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        TesseractCliOcrOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pipeline_options = PdfPipelineOptions(
        do_ocr=True,
        do_table_structure=True,
        document_timeout=float(os.getenv("DOCLING_DOCUMENT_TIMEOUT", "240")),
        ocr_options=TesseractCliOcrOptions(lang=["eng", "ind"]),
    )
    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )

    with tempfile.TemporaryDirectory(prefix="kubo-doc-") as temp_dir:
        source = Path(temp_dir) / file_name
        source.write_bytes(content)
        result = converter.convert(
            source,
            max_file_size=MAX_FILE_BYTES,
            max_num_pages=int(os.getenv("DOCUMENT_MAX_PAGES", "100")),
        )

    document = result.document
    blocks = extract_blocks(document)
    text = document.export_to_text().strip()
    if not text:
        text = "\n".join(block.text for block in blocks).strip()

    has_text_layer = pdf_has_text_layer(content) if extension == ".pdf" else False
    used_ocr = extension in {".png", ".jpg", ".jpeg", ".tif", ".tiff"} or (
        extension == ".pdf" and not has_text_layer
    )
    pages = max(1, len(getattr(document, "pages", {}) or {}))
    return ParseResponse(
        text=text,
        pages=pages,
        has_text_layer=has_text_layer,
        used_ocr=used_ocr,
        parser=f"docling-{version('docling')}",
        blocks=blocks or [Block(text=text, page=1)],
    )


def extract_blocks(document: Any) -> list[Block]:
    blocks: list[Block] = []
    for item, _level in document.iterate_items():
        text = getattr(item, "text", None)
        if not text and item.__class__.__name__ == "TableItem":
            try:
                text = item.export_to_markdown(doc=document)
            except Exception:
                text = None
        if not isinstance(text, str) or not text.strip():
            continue

        provenance = (getattr(item, "prov", None) or [None])[0]
        page = getattr(provenance, "page_no", None)
        bbox = getattr(provenance, "bbox", None)
        coordinates = None
        if bbox is not None:
            coordinates = [
                float(getattr(bbox, "l")),
                float(getattr(bbox, "t")),
                float(getattr(bbox, "r")),
                float(getattr(bbox, "b")),
            ]
        blocks.append(
            Block(
                text=text.strip(),
                page=int(page) if page is not None else None,
                bounding_box=coordinates,
            )
        )
    return blocks


def pdf_has_text_layer(content: bytes) -> bool:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(content))
        return any((page.extract_text() or "").strip() for page in reader.pages)
    except Exception:
        return False
