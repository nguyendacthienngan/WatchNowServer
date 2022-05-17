const fs = require('fs');
const _ = require('lodash');

const {
	trackUploadS3Progress,
	notifyUploadCompleted,
	trackVideoProcessingProgress,
	notifyProcessCompleted,
	trackVideoRecognitionProgress,
	notifyRrecognizedCompleted
} = require('../configs/socket');
const { getFileStream, uploadToS3, getSignedUrl } = require('../utils/aws-s3-handlers');
const { removeRedundantFiles } = require('../utils/file-handler');
const {
	converVideoToAudio,
	isVideoHaveAudioTrack,
	generateThumbnail,
	generateFileFromBuffer,
} = require('../utils/videos-handlers');
const { handleCopyright } = require('../utils/copyright-handler');
const { recogniteAudio } = require('./audio-recoginition.controller');
const { createVideoInfos } = require('./video-info.controller');
const Video = require('../models/video');

exports.getVideoById = async function (req, res) {
	const key = req.params.key;
	try {
		const readStream = await getFileStream(key)
		if (readStream) {
			readStream.pipe(res);
		}
	} catch (error) {
		res.json(error);
	}
};

exports.uploadAndProcessVideo = async function (req, res) {
	const { _id, channelId } = req.user;

	const videoBuffer = req.files && req.files.video;
	if (!videoBuffer) {
		console.log('No file');
		return res.status(400).json("No file");
	}
	if (!req.body) {
		console.log('No body')
		return res.status(400).json("No body")
	}
	try {
		const { title, fileKey: videoKey } = await generateFileFromBuffer(videoBuffer, _id);

		console.log("recogniteAudioFromVideo")
		const recognizedMusic = await _recogniteAudioFromVideo(videoKey, channelId); notifyUploadCompleted
		console.log("generateThumbnail")
		const { autogeneratedThumbnailsKey, thumbnailKey } = await generateThumbnail(videoKey, channelId);

		console.log("uploadToS3")
		for (let i = 0; i < autogeneratedThumbnailsKey.length; i++) {
			await uploadToS3(autogeneratedThumbnailsKey[i], val => val / 4 + 50 / 3 * (i + 1), channelId);
		}
		await uploadToS3(videoKey, val => val / 4 + 75, channelId);

		const saveDBResult = await _saveVideoToDatabase({
			...req.body, title, video_key: videoKey, author_id: _id,
			recognition_result: recognizedMusic?.recognizeResult,
			autogenerated_thumbnails_key: autogeneratedThumbnailsKey,
			thumbnail_key: thumbnailKey
		})

		removeRedundantFiles(videoKey);
		if (recognizedMusic) {
			removeRedundantFiles(recognizedMusic.audioKey);
		}
		
		for (let key of autogeneratedThumbnailsKey) {
			removeRedundantFiles(key);
		}
		if (saveDBResult) {
			// handleCopyright(title, channelId);
			res.status(200).json(saveDBResult)
		}
		else {
			console.log('Cannot save DB');
			res.status(500).json("Cannot save DB");
		}
	} catch (error) {
		console.log(error)
		if (error.msg) return res.status(400).json(error.msg);
		else return res.status(400).json(error);
	}
}

exports.uploadVideoWithUndergroundProcess = async function (req, res) {
	const { _id, channelId } = req.user;

	const videoBuffer = req.files && req.files.video;
	if (!videoBuffer) {
		console.log('No file');
		return res.status(400).json("No file");
	}
	if (!req.body) {
		console.log('No body')
		return res.status(400).json("No body");
	}
	try {
		const { title, fileKey: videoKey } = await generateFileFromBuffer(videoBuffer, _id);
		await uploadToS3(videoKey, val => val / 4 + 75, channelId);
		const newVideo = await _saveVideoToDatabase({
			...req.body, title, video_key: videoKey, author_id: _id,
		});
		notifyUploadCompleted(channelId, newVideo._id);

		setTimeout(async function () {
			await _processThumbnail(newVideo, channelId);
			setTimeout(async function () {
				await _checkMusic(newVideo, channelId);
				removeRedundantFiles(newVideo.video_key);
			}, 2000)
		}, 0);

		if (newVideo) {
			// handleCopyright(title, channelId);
			res.status(200).json(newVideo)
		}
		else {
			console.log('Cannot save DB');
			res.status(500).json("Cannot save DB");
		}
	} catch (error) {
		console.log(error)
		if (error.msg) return res.status(400).json(error.msg);
		else return res.status(400).json(error);
	}
}

async function _processThumbnail(newVideo, channelId) {
	console.log("generateThumbnail")
	const { autogeneratedThumbnailsKey, thumbnailKey } = await generateThumbnail(newVideo.video_key, channelId);
	trackVideoProcessingProgress(channelId, newVideo._id, 30);

	console.log("uploadThumbnailToS3");
	for (let i = 0; i < autogeneratedThumbnailsKey.length; i++) {
		await uploadToS3(autogeneratedThumbnailsKey[i], val => val / 4 + 50 / 3 * (i + 1), channelId);
		trackVideoProcessingProgress(channelId, newVideo._id, (i + 1) * 20 + 30);
	}

	await Video.findOneAndUpdate(
		{ _id: newVideo._id },
		{
			autogenerated_thumbnails_key: autogeneratedThumbnailsKey,
			thumbnail_key: thumbnailKey
		}
	)
	trackVideoProcessingProgress(channelId, newVideo._id, 100);
	for (let key of autogeneratedThumbnailsKey) {
		removeRedundantFiles(key);
	}
	notifyProcessCompleted(channelId, newVideo._id, { thumbnailUrl: getSignedUrl({ key: thumbnailKey }) });
}

async function _checkMusic(newVideo, channelId) {
	console.log("recogniteAudioFromVideo")
	const recognizedMusic = await _recogniteAudioFromVideo(newVideo.video_key, channelId, newVideo._id);
	await Video.findOneAndUpdate(
		{ _id: newVideo._id },
		{ recognition_result: recognizedMusic?.recognizeResult }
	)
	trackVideoRecognitionProgress(channelId, newVideo._id, 100);
	removeRedundantFiles(recognizedMusic.audioKey);
	notifyRrecognizedCompleted(channelId, newVideo._id, { recognizedMusic });
}

async function _saveVideoToDatabase(videoDto) {
	return new Promise(async function (resolve, reject) {
		try {
			const {
				title, description, duration,
				author_id, recognition_result,
				autogenerated_thumbnails_key,
				thumbnail_key, type, video_key
			} = videoDto;
			const fileSize = fs.statSync(video_key).size;
			const reqVideo = {
				author_id,
				title,
				description,
				duration,
				thumbnail_key,
				autogenerated_thumbnails_key,
				type,
				video_key,
				size: fileSize,
				visibility: 1,	//first set private
				recognition_result: recognition_result?.status.code === 0 ? recognition_result : null,
			}

			// Save to AWS
			const newVideo = new Video(_.omitBy(reqVideo, _.isNil));
			const videoAfterCreatedInDB = await createVideoInfos(newVideo);
			if (videoAfterCreatedInDB) {
				resolve(videoAfterCreatedInDB)
			}
			else reject("Cannot save video to DB")
		} catch (error) {
			reject(error)
		}
	})

}

async function _recogniteAudioFromVideo(videoKey, channelId, videoId) {
	try {
		const name = videoKey.split("/")[2].split(".")[0];
		const audioSavedPath = 'uploads/audios/' + name + '.mp3';
		if (videoKey) {
			const isAudioIncluded = await isVideoHaveAudioTrack(videoKey);
			trackUploadS3Progress(10, channelId);
			trackVideoRecognitionProgress(channelId, videoId, 20);
			if (isAudioIncluded) {
				const convertResult = await converVideoToAudio(videoKey, audioSavedPath);
				trackUploadS3Progress(18, channelId);
				trackVideoRecognitionProgress(channelId, videoId, 40);
				if (convertResult) {
				} else {
					throw new Error("Cannot convert music");
				}
				const bitmap = fs.readFileSync(audioSavedPath);
				trackVideoRecognitionProgress(channelId, videoId, 65);

				//TO-DO: Split to multiple audios for recognize quicker and easier to track the song name from timestamp?

				const recognizeResultACR = await recogniteAudio(Buffer.from(bitmap));
				trackUploadS3Progress(20, channelId);
				trackVideoRecognitionProgress(channelId, videoId, 82);
				if (!recognizeResultACR) return null;
				const recognizeResult = {
					savedName: videoKey,
					audioKey: audioSavedPath,
					recognizeResult: recognizeResultACR
				};
				if (recognizeResult && recognizeResultACR) {
					return recognizeResult
				} else {
					return null;
				}
			} else {
				return null;
			}
		} else {
			throw new Error("File required");
		}
	} catch (error) {
		reject(error)
	}
}