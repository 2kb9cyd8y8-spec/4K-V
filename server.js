const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const uploadDir = '/tmp/uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 200 * 1024 * 1024 } // Max 200MB
});

// Endpoint untuk check status & bangunkan server
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: '4K-V Compression Engine Ready' });
});

app.post('/compress', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tiada fail video diterima.' });
  }

  const inputPath = req.file.path;
  const outputPath = path.join(uploadDir, `out_${Date.now()}.mp4`);
  const preset = req.body.preset || 'tiktok';
  const customCrf = req.body.crf || '22';
  const customRes = req.body.resolution || '1080';
  const customFps = req.body.fps || '30';

  let vf = "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2";
  let crf = '20';
  let maxrate = '10M';
  let bufsize = '15M';
  let fps = '30';

  if (preset === 'tiktok') {
    crf = '20';
    maxrate = '10M';
    bufsize = '15M';
    fps = customFps === '60' ? '60' : '30';
  } else if (preset === 'wa_status') {
    vf = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2";
    crf = '24';
    maxrate = '3500k';
    bufsize = '5M';
    fps = '30';
  } else if (preset === 'wa_hd') {
    crf = '22';
    maxrate = '5M';
    bufsize = '8M';
    fps = '30';
  } else if (preset === 'custom') {
    crf = String(Math.min(32, Math.max(16, parseInt(customCrf) || 22)));
    fps = customFps === '60' ? '60' : '30';
    if (customRes === '720') {
      vf = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2";
    } else if (customRes === 'original') {
      vf = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
    }
    maxrate = '12M';
    bufsize = '18M';
  }

  const args = [
    '-y',
    '-i', inputPath,
    '-threads', '2',
    '-vf', vf,
    '-r', fps,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', crf,
    '-maxrate', maxrate,
    '-bufsize', bufsize,
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    outputPath
  ];

  const ffmpeg = spawn('ffmpeg', args);

  ffmpeg.on('close', (code) => {
    const cleanup = () => {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    };

    if (code !== 0 || !fs.existsSync(outputPath)) {
      cleanup();
      return res.status(500).json({ error: 'Gagal compress video.' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="compressed_4KV.mp4"');
    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('close', cleanup);
    stream.on('error', cleanup);
  });

  ffmpeg.on('error', () => {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    res.status(500).json({ error: 'Enjin FFmpeg ralat.' });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`4K-V Engine running on port ${PORT}`));
