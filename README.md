<!--
<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

-->

# KUBO Backend

NestJS API untuk workflow ekspor KUBO, termasuk shipment, document generator, dan
Document Intelligence dengan prinsip **upload once, reuse everywhere**.

## Document Intelligence

File sumber diunggah satu kali ke shipment. Backend melakukan inspection dan hashing,
memproses file di luar request upload, mengklasifikasikan dokumen, mengekstrak field,
serta menyimpan provenance. Nilai hasil ekstraksi menjadi `shipment_facts` yang dapat
digunakan sebagai default pada Commercial Invoice, Packing List, Certificate of Origin,
Bill of Lading, dan PEB. Nilai eksplisit dari pengguna tetap memiliki prioritas.

Alur:

```text
PDF / image / DOCX / XLSX / CSV
  -> inspection + SHA-256 deduplication
  -> Docling / PaddleOCR adapter
  -> deterministic classification and extraction
  -> extracted_fields + source provenance
  -> canonical shipment_facts
  -> reuse by every generated document
```

Endpoint utama:

```text
POST  /api/v1/shipments/:shipmentId/documents     multipart: file, declaredDocumentType?
GET   /api/v1/documents/:id
GET   /api/v1/documents/:id/status
GET   /api/v1/documents/:id/extractions
POST  /api/v1/documents/:id/reprocess
PATCH /api/v1/extracted-fields/:fieldId
GET   /api/v1/shipments/:shipmentId/document-facts
```

Upload mengembalikan HTTP `202`. Upload file identik pada shipment yang sama bersifat
idempotent dan mengembalikan `inspectionStatus: "duplicate"` serta document ID awal.
Koreksi pengguna disimpan dengan nilai asli dan tidak akan ditimpa oleh reprocessing.

### Parser/OCR adapter

Set `DOCUMENT_INTELLIGENCE_URL` ke service Docling/PaddleOCR. Backend memanggil
`POST {DOCUMENT_INTELLIGENCE_URL}/parse` dengan payload:

```json
{
  "file_name": "packing-list.pdf",
  "mime_type": "application/pdf",
  "content_base64": "..."
}
```

Respons adapter yang didukung:

```json
{
  "text": "...",
  "pages": 2,
  "has_text_layer": false,
  "used_ocr": true,
  "parser": "paddleocr-pp-structure-v3",
  "blocks": [
    {
      "text": "Gross Weight: 1,250 KG",
      "page": 1,
      "bounding_box": [420, 236, 585, 260]
    }
  ]
}
```

Tanpa adapter, CSV dan PDF digital sederhana memiliki fallback lokal. PDF scan, image,
DOCX, dan XLSX akan berstatus `failed` dengan pesan konfigurasi yang dapat ditindaklanjuti;
setelah adapter tersedia, endpoint `reprocess` dapat digunakan tanpa upload ulang.

Job diproses oleh BullMQ apabila `REDIS_URL` tersedia (3 percobaan dengan exponential
backoff). Tanpa Redis, development lokal tetap dapat berjalan dengan fallback in-process,
tetapi job tersebut tidak bertahan apabila process API restart.

## Menjalankan development stack

### Opsi 1 — semua service dengan Docker (disarankan)

Pastikan Docker Desktop sudah aktif, lalu dari root repository:

```powershell
Copy-Item .env.example .env
docker compose -f infrastructure/docker-compose.yml up -d --build
docker compose -f infrastructure/docker-compose.yml ps
```

Service yang tersedia:

| Service     | URL                              | Fungsi                                |
| ----------- | -------------------------------- | ------------------------------------- |
| KUBO API    | `http://localhost:3001/api/v1`   | API utama, ekstraksi, canonical facts |
| Swagger     | `http://localhost:3001/api/docs` | Dokumentasi API                       |
| Document AI | `http://localhost:8000`          | Docling parsing, OCR, layout, tabel   |
| Redis       | internal `redis:6379`            | Durable document job queue            |

Model Docling diunduh saat build/pemakaian pertama dan disimpan dalam Docker volume,
sehingga startup pertama lebih lama daripada startup berikutnya. Periksa health:

```powershell
curl.exe http://localhost:3001/api/v1/health
curl.exe http://localhost:8000/health
```

Hentikan container tanpa menghapus database/upload volume:

```powershell
docker compose -f infrastructure/docker-compose.yml down
```

Jangan menambahkan opsi `-v` kecuali memang ingin menghapus data development di volume.
Frontend tetap dijalankan terpisah:

```powershell
Set-Location C:\kubo-fe
npm run dev
```

Atur `VITE_API_BASE_URL=http://localhost:3001/api/v1` pada environment frontend.
Database Docker memakai volume `kubo-data` yang terpisah dari `C:\kubo-be\kubo.db`;
gunakan Opsi 2 jika ingin tetap memakai database host yang sudah ada.

### Opsi 2 — API di host, infrastructure di Docker

Jalankan Redis dan Document AI saja:

```powershell
docker compose -f infrastructure/docker-compose.yml up -d --build redis document-ai-service
Copy-Item .env.example .env
npm install
npm run start:dev
```

Untuk mode ini, `.env` menggunakan `DOCUMENT_INTELLIGENCE_URL=http://localhost:8000`
dan `REDIS_URL=redis://localhost:6379/0`. Frontend `C:\kubo-fe` harus memakai base URL
`http://localhost:3001/api/v1`; respons HTML seperti `<!DOCTYPE ...>` menandakan request
masuk ke dev server frontend atau URL route yang salah, bukan ke JSON API KUBO.

### Opsi 3 — tanpa Docker

API tetap dapat dijalankan dengan `npm run start:dev`. CSV dan sebagian PDF digital
memakai fallback parser, sedangkan image, PDF scan, DOCX, dan XLSX memerlukan service
Document AI. Tanpa Redis, queue otomatis memakai fallback in-process.

## Batas tanggung jawab AI

- `services/document-ai-service`: inspeksi isi, OCR, layout/table parsing, serta block
  provenance. Service ini stateless dan tidak mengakses database KUBO.
- `src/documents`: autentikasi/ownership, idempotensi, klasifikasi, field extraction,
  koreksi pengguna, dan penyimpanan `shipment_facts` untuk reuse lintas dokumen.
- Gemini/Claude pada `src/matching` tetap khusus container matching. Dokumen tidak
  dikirim ke provider LLM eksternal oleh baseline ini.

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
