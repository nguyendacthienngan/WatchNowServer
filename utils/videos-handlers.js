const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const { trackProgress } = require('../configs/socket');

const converVideoToAudio = function (input, output) {
	let nextProgress = 0;
	return new Promise(async function (resolve, reject) {
		try {
			ffmpeg(input)
				.output(output)

				.on('progress', (progress) => {
					if (progress) {
						if (nextProgress >= 100 || (nextProgress < 100 && progress.percent >= nextProgress)) {
							nextProgress += 15;
						}
					}
				})
				.on('error', function (err) {
					reject(err)
				})
				.on('end', function () {
					resolve(output)
				})
				.run();
		} catch (error) {
			reject(error)
		}

	});
}

function isVideoHaveAudioTrack(input) {
	return new Promise(function (resolve, reject) {
		try {
			ffmpeg(input)
				.ffprobe(function (err, data) {
					if (err)
						throw new Error(err);
					if (data)
						resolve(data.streams.length > 1);
					else if (!err)
						throw new Error('No data to track audio');
				});
		} catch (error) {
			reject(error)
		}
	})
}

async function compressVideo(input, output, app) {
	let nextProgress = 0;
	return new Promise(function (resolve, reject) {
		try {
			ffmpeg(input)
				.addOutputOption(["-vcodec libx265"])
				.on("start", function (commandLine) {
					console.log("Spawned FFmpeg with command: " + commandLine);
				})
				.on('progress', (progress) => {
					if (progress) {
						if (nextProgress >= 100 || (nextProgress < 100 && progress.percent >= nextProgress)) {
							trackProgress(progress, 'Compress video');
							nextProgress += 15;
						}
					}
				})
				.on('end', function () {
					console.log('conversion ended');
					resolve('conversion ended')
				})
				.on('error', function (err) {
					reject(err)
				}).save(output)
		} catch (error) {
			reject(error)
		}

	});
}

function convertToWebmFormat(input, output, app) {
	const io = app.get('socketio');
	let nextProgress = 0;
	return new Promise(function (resolve, reject) {
		try {
			console.log("Convert to webm")
			ffmpeg(input)
				.addOutputOption(["-f webm"])
				.on("start", function (commandLine) {
					console.log("Spawned FFmpeg with command: " + commandLine);
				})
				.on('progress', (progress) => {
					if (progress) {
						if (nextProgress >= 100 || (nextProgress < 100 && progress.percent >= nextProgress)) {
							trackProgress(progress, 'Convert to Webm Format');
							nextProgress += 15;
						}
					}
				})
				.on('end', function () {
					console.log('conversion ended');
					resolve('conversion ended')
				})
				.on('error', function (err) {
					console.log('error: ', err);
					reject(err)
				}).save(output)

		} catch (error) {
			reject(error)
		}
	});
}

function generateThumbnail(videoFilePath) {
	let thumbsFilePath = "";
	let nextProgress = 0;
	console.log("begin generate thumbnail")
	return new Promise(function (resolve, reject) {
		try {
			ffmpeg(videoFilePath)
				.on('filenames', function (filenames) {
					console.log("filesname")
					console.log('Will generate ' + filenames.join(', '))
					thumbsFilePath = "uploads/thumbnails/" + filenames[0];
				})
				.on('progress', (progress) => {
					if (progress) {
						console.log("progress")
						console.log(progress)
						if (nextProgress >= 100 || (nextProgress < 100 && progress.percent >= nextProgress)) {
							trackProgress(progress / 4 + 25, 'Upload to S3');
							nextProgress += 15;
						}
					}
				})
				.on('end', function () {
					console.log('Screenshots taken');
					resolve(thumbsFilePath);
				})
				.screenshots({
					// Will take screens at 20%, 40%, 60% and 80% of the video
					count: 1,
					folder: 'uploads/thumbnails',
					size: '1280x720',
					// %b input basename ( filename w/o extension )
					filename: 'thumbnail-%b.png'
				});
		}
		catch (err) {
			reject(err);
		}
	})
}

function encodeFileName(fileName, userId) {
	const timeStamp = Math.floor(Date.now() / 1000);
	let { name } = path.parse(fileName);
	name = name.replace(/[^a-z0-9/]/gi, '_').toLowerCase();
	return name + "_" + userId + "_" + timeStamp
}

function seperateTitleAndExtension(fileName) {
	const fileNameSplittedArray = fileName.split('.');
	const extension = fileNameSplittedArray.pop();
	const title = fileNameSplittedArray.join('.');
	return { title, extension };
}

async function generateVideoFile(file, body) {
	const { data: dataBuffers, name: fileName } = file;
	console.log(file, body)
	const { ext } = path.parse(fileName);
	const encodedFileName = encodeFileName(fileName, body.author_id);
	const { title } = seperateTitleAndExtension(fileName);
	const videoPath = 'uploads/videos/' + encodedFileName + ext;

	return new Promise(function (resolve, reject) {
		try {
			fs.writeFileSync(videoPath, dataBuffers);
			resolve({
				title,
				videoPath
			});
		}
		catch (err) {
			reject(err);
		}
	})
}

module.exports = {
	encodeFileName,
	convertToWebmFormat,
	compressVideo,
	isVideoHaveAudioTrack,
	converVideoToAudio,
	generateThumbnail,
	seperateTitleAndExtension,
	generateVideoFile
}
