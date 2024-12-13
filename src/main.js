import "./style.css";
import p5 from "p5";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  await ffmpeg
    .exec(options.video.exec)
    .catch((err) => console.log(err.message));

  // // Load video into ffmpeg
  // const videoFile = await fetchFile(videoUrl);
  // await ffmpeg.writeFile("videos/video.mp4", videoFile);

  // // Get first second of input video
  // await ffmpeg
  //   .exec([
  //     "-i",
  //     "videos/video.mp4",
  //     "-ss",
  //     "0",
  //     "-t",
  //     "1",
  //     "-map",
  //     "0",
  //     "-c",
  //     "copy",
  //     "videos/first.mp4",
  //   ])
  //   .catch((err) => console.log(err.message));

  // // Combine videos
  // await ffmpeg
  //   .exec([
  //     // "-i",
  //     // "videos/first.mp4",
  //     // "-i",
  //     // "videos/output.mp4",
  //     // "-filter_complex",
  //     // "hstack",
  //     // "videos/final.mp4",

  //     // "-f",
  //     // "concat",
  //     // // "-safe",
  //     // // "0",
  //     // "-i",
  //     // "join_video.txt",
  //     // "-c",
  //     // "copy",
  //     // "videos/final.mp4",

  //     "-f",
  //     "concat",
  //     "-i",
  //     "videos/first.mp4",
  //     "-i",
  //     "videos/output.mp4",
  //     "-codec",
  //     "copy",
  //     "videos/final.mp4",
  //   ])
  //   .catch((err) => console.log(err.message));

  // const test = await ffmpeg.listDir("videos");
  // console.log(test);

  // // Overlay videos
  // await ffmpeg.exec([
  //   "-i",
  //   "videos/video.mp4",
  //   "-i",
  //   "videos/output.mp4",
  //   "-filter_complex",
  //   "'[0][overlay]; [1][overlay]'",
  //   "-map",
  //   "0",
  //   "-c",
  //   "copy",
  //   "videos/final.mp4",
  // ]);

  // const file2 = await ffmpeg.readFile("videos/final.mp4");
  // console.log(file2);

  // Download files
  const filename = `output_${new Date().toISOString()}.${options.video.ext}`;
  const filePath = `videos/${options.video.filename}`;
  // const filePath = `videos/output.mp4`;
  const file = await ffmpeg.readFile(filePath);
  if (typeof file !== "string") {
    // file: FileData typeof Uint8Array | string
    const data = new Blob([file.buffer], { type: options.video.type });
    downloadFile(data, filename);
  }

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
  // console.log("seeked");

  await captureFrame(i);

  i++;

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

  // video.time(0);
  video.pause();

  const joinFile = await fetchFile("/join_video.txt");
  await ffmpeg.writeFile("join_video.txt", joinFile);
  // console.log(joinFile);

  console.log(await ffmpeg.listDir("/"));

  // Create ffmpeg directory for canvas images
  await ffmpeg.createDir("frames");
  await ffmpeg.createDir("videos");

  video.time(i);
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
