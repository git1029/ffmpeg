import "./style.css";
import p5 from "p5";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

// const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const downloadFile = (data, filename) => {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

let ffmpeg = null;
let ffmpegLoaded = false;
let canvas = null;
let video = null;
let videoUrl = "/images/vid_1.mp4";
let videoLoaded = false;
let recording = false;
let fps = 30;
let duration = 1; // seconds (will be replaced with video duration)
let frames = duration * fps;
let i = 0;

const progress = document.getElementById("progress");
const button = document.getElementById("download");
button.disabled = true;
const message = document.getElementById("message");

const loadFFmpeg = async () => {
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.4/dist/esm";
  if (ffmpeg === null) {
    ffmpeg = new FFmpeg();

    ffmpeg.on("log", ({ message }) => {
      console.log("log", message);
    });
    ffmpeg.on("progress", ({ progress }) => {
      console.log("progress", progress);
    });

    // Load ffmpeg files
    try {
      // toBlobURL is used to bypass CORS issue, urls with the same
      // domain can be used directly.
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          "text/javascript"
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          "application/wasm"
        ),
      });

      console.log("loaded FFmpeg");
      ffmpegLoaded = true;
    } catch (error) {
      console.log(error);
    }
  }
};

loadFFmpeg();

// Delete ffmpeg files and directory
const deleteFiles = async (dir) => {
  const files = await ffmpeg.listDir(dir);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if ([".", ".."].includes(file.name)) continue;
    if (!file.isDir) {
      console.log(`FFMPEG: Deleting file: ${dir}/${file.name}`);
      await ffmpeg.deleteFile(`${dir}/${file.name}`);
    }
  }
  console.log(`FFMPEG: Deleting directory: ${dir}`);
  await ffmpeg.deleteDir(dir);
};

// Ffmpeg settings
// exec is what ffmpeg uses to convert a list of pngs (frames/0.png, frames/1.png, ...) into an mp4 video
// compression and bitrate can be set with the preset and crf options
const options = {
  video: {
    type: "video/mp4",
    ext: "mp4",
    filename: `output.mp4`,
    exec: [
      "-framerate",
      `${fps}`,
      "-i",
      `frames/%d.png`,
      "-preset",
      "ultrafast",
      "-crf",
      "17",
      "-pix_fmt",
      "yuv420p",
      `videos/output.mp4`,
    ],
  },
};

const captureFrame = async () => {
  renderer.animate(i);

  message.innerHTML = `FFMPEG: Capturing frame: ${i + 1}/${frames}`;

  // Note: Firefox will block reading data from canvas if privacy.resistFingerprinting is enabled in browser config
  // https://support.mozilla.org/en-US/questions/1398931
  const blob = await new Promise((resolve) =>
    canvas.elt.toBlob((blob) => {
      if (blob) return resolve(blob);
      throw new Error("Error converting canvas to blob");
    })
  );
  const buffer = new Uint8Array(await blob.arrayBuffer());

  // // Add small delay to give time for renderer to render frame
  // await timeout(50);

  const outFile = `${i}.png`;
  await ffmpeg.writeFile(`frames/${outFile}`, buffer);
};

const createVideo = async () => {
  // Convert frames into video
  await ffmpeg
    .exec(options.video.exec)
    .catch((err) => console.log(err.message));

  // Download output file
  const filename = `output_${new Date().toISOString()}.${options.video.ext}`;
  const filePath = `videos/${options.video.filename}`;
  const file = await ffmpeg.readFile(filePath);
  if (typeof file !== "string") {
    // file: FileData typeof Uint8Array | string
    const data = new Blob([file.buffer], { type: options.video.type });
    downloadFile(data, filename);
  }

  // Delete files in ffmpeg directory
  await deleteFiles("frames");
  await deleteFiles("videos");

  recording = false;
  document.body.classList.remove("recording");
  message.innerHTML = "";
  video.play();
  video.time((renderer.frameCount / fps) % video.elt.duration);
  i = 0;
};

const onVideoSeeked = async () => {
  await captureFrame(i);

  i++;

  // Remove listener when reach end of video
  if (i >= frames) {
    await createVideo();

    video.elt.removeEventListener("seeked", onVideoSeeked);
    return;
  }

  const time = i / fps;
  video.time(time);
};

const capture = async () => {
  if (
    recording ||
    !ffmpeg ||
    !ffmpegLoaded ||
    !canvas ||
    !renderer ||
    !videoLoaded
  )
    return;

  recording = true;
  document.body.classList.add("recording");
  renderer.animate(0);
  video.pause();

  // Create ffmpeg directory for canvas images
  await ffmpeg.createDir("frames");
  await ffmpeg.createDir("videos");

  video.time(i);

  // Setup video time seek listener so render is captured once new frame/time has loaded
  video.elt.addEventListener("seeked", onVideoSeeked);
};

const sketch = (p5) => {
  p5.setup = () => {
    canvas = p5.createCanvas(500, 500, document.getElementById("canvas"));
    p5.rectMode(p5.CENTER);

    video = p5.createVideo([videoUrl], () => {
      p5.resizeCanvas(video.width, video.height);
      videoLoaded = true;
      duration = video.elt.duration;
      frames = p5.floor(duration * fps);
      console.log("video duration:", video.elt.duration, "frames:", frames);
      button.disabled = false;
    });
    video.hide();
    video.volume(0);
    video.loop();
  };

  p5.animate = (frame) => {
    p5.frameRate(recording ? 60 : fps); // p5js will "skip" frames if < 60 so set to 60 during export so correct number of frames are recorded

    progress.style.width = `${((frame % frames) / frames) * 100}%`;

    const time = ((frame % frames) / frames) * p5.TWO_PI;

    p5.background(0);
    p5.image(video, 0, 0, p5.width, p5.height);
    p5.fill("white");
    p5.rect(
      p5.width / 2 + (p5.sin(time) * p5.width) / 4,
      p5.height / 2,
      200,
      200
    );
    p5.fill("black");
    p5.rect(
      p5.width / 2 + (p5.sin(time) * p5.width) / 4,
      p5.height / 2,
      100 * (p5.sin(time) * 0.5 + 0.5),
      100 * (p5.sin(time) * 0.5 + 0.5)
    );
  };

  p5.draw = () => {
    // When not recording rely on request animation frame loop (draw())
    if (!recording) p5.animate(p5.frameCount);
  };
};

const renderer = new p5(sketch);

button.addEventListener("click", capture);
