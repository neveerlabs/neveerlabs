# Panduan Projects Neverlabs

Dokumen ini menjelaskan cara menyiapkan Supabase, mengisi proyek melalui Table Editor, mengunggah media, dan menghubungkan API ke situs.

## 1. Siapkan atau perbarui database

Pilih satu jalur sesuai kondisi database:

- **Database baru:** jalankan `schema.sql` satu kali untuk membuat skema terkini, lalu jalankan `commit_manager.sql`. Jangan jalankan file migrasi setelah `schema.sql`; definisi tabel dan perubahan migrasinya sudah termasuk di sana.
- **Database lama, lewat SQL Editor:** jalankan migrasi `20261125162200_add_changelog_title.sql`, lalu `20261126010000_simplify_contributors_and_remove_changelog_framework.sql`. Setelahnya, jalankan ulang `commit_manager.sql`.
- **Database lama, lewat Supabase CLI:** terapkan semua file di `migrations/` dalam urutan timestamp, lalu jalankan ulang `commit_manager.sql`.

`schema.sql` adalah setup lengkap untuk database baru: membuat tabel `projects` dan `project_changelogs`, bucket publik `project-media`, serta aturan akses dan pemicu penghapusan media. Ekstensi `pg_net` dan schema `vault` juga disiapkan. `commit_manager.sql` memasang fungsi commit atomik yang hanya dapat dipanggil dengan role `service_role`.

### Riwayat migrasi

| File | Peran |
| --- | --- |
| [`20261125162200_add_changelog_title.sql`](./migrations/20261125162200_add_changelog_title.sql) | Menambahkan judul changelog; judul lama diisi dari versi. |
| [`20261126010000_simplify_contributors_and_remove_changelog_framework.sql`](./migrations/20261126010000_simplify_contributors_and_remove_changelog_framework.sql) | Memastikan kolom kontributor tersedia, merapikan data kontributor menjadi nama dan URL, lalu menghapus framework changelog. |

Migrasi contributor perantara dihapus karena perubahan yang sama sudah tercakup dalam migrasi final dan belum tercatat pada riwayat migrasi remote. File migrasi bertimestamp yang tersisa adalah riwayat database; setelah diterapkan/tercatat, jangan menghapus, mengganti nama, atau mengubahnya.

## 2. Tambahkan proyek melalui Table Editor

1. Buka **Table Editor → `public.projects` → Add new row**.
2. Isi kolom seperti berikut. Kolom yang tidak diperlukan boleh dibiarkan kosong.

| Kolom | Cara mengisi |
| --- | --- |
| `id` | Biarkan nilai bawaan `gen_random_uuid()`. Jangan isi sendiri. |
| `name` | Nama proyek yang unik, misalnya `Neverlabs Website`. |
| `visibility` | Isi `public` agar proyek tampil. Nilai yang didukung: `public` atau `private`. |
| `platform` | Pilih/isi salah satu: `web`, `mobile application`, `desktop application`, `cli`, atau `other`. |
| `description` | Isi JSON, misalnya `{"en":"Personal brand website.","zh":"个人品牌网站。"}`. Deskripsi mendukung Markdown/GFM dan HTML yang disanitasi, termasuk CSS inline yang diizinkan. |
| `framework` | Jika digunakan, isi sebagai array JSON, misalnya `["React","TypeScript"]`. |
| `keyword` | Jika digunakan, isi sebagai array JSON, misalnya `["portfolio","website"]`. |
| `contributors` | Kosongkan jika tidak ada, atau isi JSON array seperti `[{"name":"Nama","url":"https://example.com"}]`. `url` opsional dan digunakan sebagai tautan kontak. |
| `primary_media` | Biarkan kosong jika belum mengunggah gambar/video utama. Jika sudah, isi URL publik medianya. |
| `media` | Biarkan nilai bawaan `[]`, atau isi array JSON berisi URL media tambahan. |
| `url` | Opsional: URL situs/demo proyek. |
| `created_at` | Gunakan nilai bawaan waktu sekarang. Jika Table Editor meminta nilai, isi tanggal dan waktu saat ini. |
| `completed_at` | Opsional. Kosongkan jika proyek masih berjalan atau tanggal selesai tidak diketahui. |
| `sort_order` | Gunakan nilai bawaan `0`; angka lebih kecil tampil lebih dahulu. |

Di Table Editor, kolom `framework` dan `keyword` bertipe `_text`; gunakan format array JSON seperti `["React","TypeScript"]`, bukan `React, TypeScript` atau `{React}`. Untuk kolom JSON, `NULL` huruf besar bukan JSON yang valid: biarkan kolom kosong atau gunakan `null` huruf kecil. Untuk `contributors` tanpa data, gunakan `[]`; setiap item hanya menyimpan `name` dan `url` opsional.

3. Klik **Queue changes**, lalu konfirmasikan **Save/Apply changes** jika diminta.

Hanya proyek dengan `visibility` bernilai `public` yang dikirim API. Tabel `project_changelogs` boleh dibiarkan kosong; halaman detail akan menampilkan keterangan bahwa belum ada catatan rilis.

### Tambahkan catatan rilis (opsional)

Di **Table Editor → `public.project_changelogs` → Add new row**, isi:

- `project_id`: salin nilai `id` dari baris proyek yang ingin diperbarui.
- `title`: judul rilis, misalnya `Initial release`.
- `version`: misalnya `v1.0.0`.
- `release`: salah satu `stable`, `latest`, atau `pre-release`.
- `description`: JSON bilingual; isi mendukung Markdown/GFM dan HTML yang disanitasi. Markdown image muncul sesuai posisi di source, sedangkan HTML/CSS inline dapat mengatur posisi dan ukuran media.
- `contributors`: array JSON, misalnya `[{"name":"Nama","url":"https://example.com"}]`, atau `[]`. URL opsional.
- `media`: array JSON berisi URL media rilis yang dikelola di Storage, atau gunakan `[]`. Untuk menampilkan gambar/video di changelog, sisipkan media pada `description` dengan Markdown atau HTML.
- `released_at`: gunakan waktu bawaan.

Contoh media rata tengah dengan ukuran yang diatur dari deskripsi:

```html
<div style="text-align:center">
  <img src="https://.../preview.png" alt="Preview" style="width:70%; height:auto; object-fit:contain">
</div>
```

CSS yang didukung berupa inline `style` dengan properti aman seperti ukuran, margin/alignment, warna, tipografi, dan `object-fit`. Tag `<style>`, JavaScript, atribut event seperti `onerror`, iframe, dan URL berbahaya tidak dijalankan atau dibolehkan; properti CSS lain yang tidak masuk allowlist akan diabaikan.

## 3. Unggah gambar atau video

1. Buka **Storage → `project-media`**. Bucket ini dibuat oleh `schema.sql` dan disiapkan sebagai bucket publik.
2. Unggah file gambar atau video ke bucket. Buat folder di dalam bucket bila ingin mengelompokkan file.
3. Salin **public URL** file yang diunggah. Bentuk URL biasanya:

   ```text
   https://<project-ref>.supabase.co/storage/v1/object/public/project-media/<nama-file>
   ```

4. Kembali ke baris proyek di Table Editor:
   - Tempel URL gambar/video utama ke `primary_media`.
   - Tempel URL media tambahan ke `media` sebagai array JSON, misalnya `["https://.../preview.png","https://.../demo.mp4"]`.
   - Untuk media yang ingin ditampilkan inline di catatan rilis, sisipkan pada `description` dengan Markdown atau HTML. Kolom `media` tetap mencatat file Storage agar proses pembersihan dapat mengelolanya.

Gambar utama dipakai sebagai thumbnail dan ditampilkan di halaman detail. URL video dengan akhiran `.mp4`, `.webm`, `.mov`, atau `.m4v` ditampilkan sebagai video. Jangan masukkan URL file privat atau kredensial ke data proyek publik.

## 4. Hubungkan situs ke Supabase

Situs membaca data melalui endpoint server `/api/projects`; browser tidak menggunakan service-role key secara langsung.

### Lokal

1. Buat atau perbarui file `.env` di folder utama proyek dengan variabel berikut:

   ```dotenv
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```

2. Ambil URL proyek dan service-role key dari pengaturan API proyek Supabase.
3. Jangan menambahkan awalan `VITE_` pada key tersebut, jangan mengirimkannya ke siapa pun, dan jangan commit file `.env`.
4. Jalankan ulang server lokal setelah mengubah `.env`, lalu buka endpoint `/api/projects` pada alamat dan port yang ditampilkan Vite.

Respons `[]` berarti koneksi API berhasil, tetapi belum ada proyek publik. Respons `500` berarti periksa URL/key di `.env` dan log server.

### Vercel

1. Buka **Vercel → Project → Settings → Environment Variables**.
2. Tambahkan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` dengan nilai yang sama seperti di lokal. Pilih lingkungan **Preview** dan **Production**.
3. Simpan, lalu deploy ulang agar fungsi API menggunakan variabel terbaru.
4. Buka `https://<domain-situs>/api/projects` untuk memeriksa respons. Setelah proyek publik tersedia, buka halaman `/en/projects` atau `/zh/projects`.

Jangan pernah memakai service-role key pada kode frontend atau variabel `VITE_*`.

## 5. Kelola data lewat panel admin web

Panel desktop mengelola tabel `projects` dan `project_changelogs` melalui API server. File `.env` di folder utama harus berisi `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, dan password admin:

```dotenv
ADMIN_PASSWORD=<password-panjang-dan-unik>
ADMIN_SESSION_SECRET=<rahasia-acak-opsional>
```

Jangan gunakan awalan `VITE_` dan jangan commit `.env`. Jika `ADMIN_SESSION_SECRET` tidak diisi, server memakai `SUPABASE_SERVICE_ROLE_KEY` untuk menandatangani sesi. Salin nama variabel dari [`.env.example`](../.env.example), isi password pilihanmu secara lokal, lalu restart server.

Jalankan Vite dari folder utama dan buka `http://127.0.0.1:5173/admin/`. Password diverifikasi di server dan tidak dimasukkan ke bundle browser. Sesi memakai cookie `HttpOnly`, `SameSite=Strict`, berumur 30 menit. Password diminta saat membuka atau memuat ulang panel, dan saat tab browser disembunyikan; berpindah tabel atau memilih data tidak mengunci sesi.

Untuk Vercel, tambahkan `ADMIN_PASSWORD` dan (disarankan) `ADMIN_SESSION_SECRET` di **Project → Settings → Environment Variables**, lalu deploy ulang. Jangan memasukkan kedua nilai tersebut ke variabel `VITE_*`.

Pilih tabel dari sidebar, cari atau pilih baris dari daftar, lalu lihat detail, edit, buat, atau antrekan penghapusan. Perubahan tetap lokal sampai tombol **Commit changes**; satu pemanggilan `apply_projects_commit` menerapkan semua perubahan baris dalam satu transaksi database.

Pemilih media dapat memilih file yang sudah ada atau menyiapkan unggahan baru. URL file baru langsung tersedia untuk disalin ke deskripsi, tetapi file diunggah paralel (maksimal tiga sekaligus) hanya saat commit. File dikirim langsung ke Supabase menggunakan signed upload URL; service-role key tetap di server. Jika commit database gagal, file yang sudah diunggah akan dibersihkan. Jika hasil transaksi tidak dapat dipastikan karena koneksi terputus, periksa data Supabase sebelum mencoba commit ulang.

Format file yang didukung: JPG/JPEG, PNG, GIF, WebP, AVIF, MP4, MOV, M4V, dan WebM. Manajer terminal lama masih tersedia sebagai alternatif melalui `npm run projects:manage`.

Menghapus pilihan media dari sebuah baris hanya melepas tautannya; file Storage tidak otomatis dihapus karena mungkin dipakai baris lain. Penghapusan proyek atau catatan rilis dapat menghapus file terkait setelah pengaturan Edge Function dan Vault di bagian berikut selesai.

## 6. Aktifkan penghapusan media otomatis (opsional)

API daftar/detail proyek tidak memerlukan Edge Function ini. Fungsi ini hanya diperlukan agar file di Storage ikut dihapus ketika proyek atau catatan rilis yang memiliki file dihapus. Sebelum menghapus data bermedia, selesaikan langkah berikut; jika belum, pemicu database akan menolak penghapusan agar file tidak tertinggal.

1. Jika Supabase CLI belum terpasang, jalankan dari folder utama proyek:

   ```sh
   npm install --save-dev supabase
   ```

   Perintah ini menambahkan CLI sebagai dependency pengembangan. Setelah itu, autentikasi dan deploy fungsi:

   ```sh
   npx supabase login
   npx supabase link --project-ref PROJECT_REF
   npx supabase functions deploy delete-project-media --project-ref PROJECT_REF
   ```

   Ganti `PROJECT_REF` dengan **Reference ID** proyek Supabase (bukan URL penuh). Nilainya ada di **Settings → General** atau di URL Dashboard setelah `/project/`. `login` akan meminta otorisasi lewat browser. `link` menghubungkan folder lokal dan mungkin meminta password database; password ini berbeda dari service-role key dan tidak boleh dikirim lewat chat.

2. Simpan dua rahasia berikut di **Database → Vault** jika menu tersebut tersedia:

   - Nama `project_media_cleanup_function_url`, nilai `https://PROJECT_REF.supabase.co/functions/v1/delete-project-media`.
   - Nama `project_media_cleanup_service_role_key`, nilai service-role key proyek.

   Alternatifnya, buka **SQL Editor** dan jalankan perintah berikut setelah mengganti `PROJECT_REF` dan `SERVICE_ROLE_KEY` dengan nilai sebenarnya:

   ```sql
   select vault.create_secret(
     'https://PROJECT_REF.supabase.co/functions/v1/delete-project-media',
     'project_media_cleanup_function_url'
   );
   select vault.create_secret(
     'SERVICE_ROLE_KEY',
     'project_media_cleanup_service_role_key'
   );
   ```

Jalankan `vault.create_secret` satu kali untuk setiap nama rahasia. Service-role key sangat rahasia: jangan commit, bagikan, atau tempelkan ke percakapan. Untuk memeriksa kegagalan, lihat log Edge Function dan respons `pg_net` di Supabase.
