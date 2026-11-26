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
  limits: { fileSize: 200 * 1024 * 1024 }
});

const jobs = new Map();

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: '4K-V Engine v2 Ready' });
});

// 1. Terima video & mula proses di background
app.post('/compress', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tiada fail video.' });

  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const inputPath = req.file.path;
  const outputPath = path.join(uploadDir, `out_${jobId}.mp4`);
  const preset = req.body.preset || 'tiktok';
  const customCrf = req.body.crf || '23';
  const customRes = req.body.resolution || '1080';
  const customFps = req.body.fps || '30';

  let vf = "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2";
  let crf = '22';
  let maxrate = '8M';
  let bufsize = '12M';
  let fps = '30';

  if (preset === 'tiktok') {
    crf = '21';
    maxrate = '10M';
    bufsize = '15M';
    fps = customFps === '60' ? '60' : '30';
  } else if (preset === 'wa_status') {
    vf = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2";
    crf = '25';
    maxrate = '3000k';
    bufsize = '4M';
    fps = '30';
  } else if (preset === 'wa_hd') {
    crf = '23';
    maxrate = '5M';
    bufsize = '8M';
    fps = '30';
  } else if (preset === 'custom') {
    crf = String(Math.min(32, Math.max(18, parseInt(customCrf) || 23)));
    fps = customFps === '60' ? '60' : '30';
    if (customRes === '720') {
      vf = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2";
    } else if (customRes === 'original') {
      vf = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
    }
    maxrate = '10M';
    bufsize = '15M';
  }

  jobs.set(jobId, { status: 'processing', outputPath, createdAt: Date.now() });
  res.json({ jobId });

  const args = [
    '-y',
    '-i', inputPath,
    '-threads', '1',
    '-vf', vf,
    '-r', fps,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
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
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (code === 0 && fs.existsSync(outputPath)) {
      jobs.set(jobId, { status: 'done', outputPath, createdAt: Date.now() });
      // Auto-padam selepas 10 minit jika tak didownload
      setTimeout(() => {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        jobs.delete(jobId);
      }, 10 * 60 * 1000);
    } else {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      jobs.set(jobId, { status: 'error', error: 'Gagal compress (video terlalu besar untuk RAM server).' });
    }
  });

  ffmpeg.on('error', () => {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    jobs.set(jobId, { status: 'error', error: 'Enjin FFmpeg ralat.' });
  });
});

// 2. Check status job
app.get('/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ status: 'error', error: 'Job tidak dijumpai / tamat tempoh.' });
  res.json({ status: job.status, error: job.error || null });
});

// 3. Download hasil video
app.get('/download/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done' || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Fail belum siap atau sudah dipadam.' });
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="compressed_4KV.mp4"');
  const stream = fs.createReadStream(job.outputPath);
  stream.pipe(res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`4K-V Engine v2 running on port ${PORT}`));
