# dl-repostium

Aplikasi downloader Node.js yang menggunakan `yt-dlp` untuk mengunduh media dari tautan publik TikTok, Instagram, dan Facebook.

## Menjalankan

```powershell
python -m pip install -r requirements.txt
node server.js
```

Buka `http://localhost:3000`.

Backend membatasi URL ke host platform yang didukung dan memakai `yt-dlp` untuk membaca judul, caption, thumbnail, dan durasi sebelum unduhan. Pilihan kualitas diterapkan saat mengunduh. Hasil unduhan disimpan sementara di direktori sistem hingga 30 menit. Maksimal dua proses yt-dlp berjalan bersamaan dan ukuran unduhan dibatasi 300 MB. Media yang diunduh tersedia melalui endpoint sementara `/api/files/...`. Gunakan hanya untuk media yang Anda miliki atau berhak unduh; downloader tidak menyediakan bypass login, DRM, atau konten privat.

Python harus tersedia pada `PATH`. Untuk menggunakan executable Python tertentu, set variabel lingkungan `PYTHON`. `ffmpeg` mungkin diperlukan oleh `yt-dlp` untuk format atau media tertentu.

Instagram kadang meminta login atau memblokir pengambilan media, termasuk untuk tautan yang sebelumnya bisa diakses publik. Dalam kasus itu aplikasi menampilkan pesan bahwa konten memerlukan login dan tidak mencoba melewati halaman login. Jangan unggah cookie atau kredensial Instagram ke server. Untuk media milik Anda sendiri yang tidak tersedia publik, gunakan fitur ekspor resmi Instagram.

## Import ke Replit

1. Unggah `dl-repostium-replit.zip` saat membuat Repl baru dari ZIP.
2. Tunggu proses setup pertama selesai; konfigurasi Replit membuat virtualenv dan memasang `requirements.txt`.
3. Tekan **Run** untuk menjalankan Repl atau gunakan **Publish** untuk membuat deployment Autoscale.

`replit.nix` menyediakan Node.js dan Python. Konfigurasi deployment memasang dependensi saat build dan menjalankan server dengan interpreter virtualenv. Jangan menghapus `.replit` atau `replit.nix`; keduanya mengatur runtime, port web, dan perintah deploy. Repl yang dipublikasikan dapat menerima request dari siapa saja, jadi perhatikan batas penggunaan serta biaya resource.
