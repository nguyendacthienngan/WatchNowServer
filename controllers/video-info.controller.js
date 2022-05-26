const _ = require('lodash');
const mongoose = require("mongoose");
const { ObjectId } = mongoose.Types;

const Video = require('../models/video');
const { VideoTag } = require('../constants/video');
const User = require('../models/user');
const Account = require('../models/account');
const WatchHistoryDate = require('../models/watchHistoryDate');
const { getSignedUrl } = require('../utils/aws/s3');
const { generateFileFromBuffer, formatVideo } = require('../utils/videos-handlers');
const { uploadToS3 } = require('../utils/aws/s3');
const { removeRedundantFiles } = require('../utils/file-handler');

const ONE_FETCH = 24;
const AUTH_RANDOM_FOLLOW_CHANNELS = 3;
const AUTH_FOLLOW_EACH_CHANNEL = 3;
const TOP_VIEW_ANONYMUS_ONE_FETCH = 4;
const TOP_LIKE_ANONYMUS_ONE_FETCH = 4;

exports.createVideoInfos = function (video) {
	return new Promise(async function (resolve, reject) {
		try {
			const videoSaved = await video.save();
			if (videoSaved) {
				resolve(video);
			} else {
				throw new Error('Cannot save video')
			}
		} catch (error) {
			reject(error);
		}
	});
}

exports.getAllPublicVideoInfos = function (req, res) {
	Video.find({ visibility: 0 })
		.then(function (docs) {
			const formattedDocs = docs.map(function (doc) {
				const formattedDoc = { ...doc._doc };
				formattedDoc.thumbnail_url = getSignedUrl({ key: formattedDoc.thumbnail_key });
				formattedDoc.url = getSignedUrl({ key: formattedDoc.video_key });
				delete formattedDoc.video_key;
				delete formattedDoc.thumbnail_key;
				return formattedDoc;
			});

			res.json({ videos: formattedDocs });
		})
}

exports.getVideoInfoById = async function (req, res, next) {
	try {
		const { id } = req.params;

		if (!ObjectId.isValid(id))
			return res.status(400).json({ message: "This video isn't available any more" });

		const video = await Video.findOne({ _id: id }).select("+likes +customized_thumbnail_key +autogenerated_thumbnails_key ");

		if (!video)
			return res.status(400).json({ message: "This video isn't available any more" });

		if (video.visibility === 3 && (!req.user || video.author_id.toString() !== req.user._id))
			return res.status(400).json({ message: "Video unavailable. This video have copyright claimed" });

		if (video.visibility === 1 && (!req.user || video.author_id.toString() !== req.user._id)) {
			return res.status(400).json({ message: "Video unavailable. This video is private" });
		}

		const formattedVideo = await formatVideo({ ...video._doc }, true);
		res.json(formattedVideo);
	}
	catch (err) {
		console.log({ err })
		next(err);
	}
};

exports.getSearchSuggestions = async function (req, res) {
	const MAX_SEARCHED_VIDEOS_COUNT = 7;
	const MAX_SEARCHED_ACCOUNTS_COUNT = 3;

	const { keyword } = req.query;
	const trimmedKeyword = keyword;

	const searchedAccounts = await Account.find(
		{ username: { $regex: trimmedKeyword } }
	).limit(MAX_SEARCHED_ACCOUNTS_COUNT);

	const searchedVideos = await Video.find(
		{
			title: { $regex: trimmedKeyword, },
			visibility: 0
		},
	).limit(MAX_SEARCHED_VIDEOS_COUNT);

	const searchedResults = [
		...searchedAccounts.map(item => ({ keyword: item.username, model: "Channel" })),
		...searchedVideos.map(item => ({ keyword: item.title, model: "Video" }))
	];

	res.json({
		count: searchedResults.length,
		searchedResults
	});
}

exports.getSearchResults = async function (req, res) {
	const { keyword } = req.query;
	const trimmedKeyword = keyword.trim();

	const searchedResults = await Video
		.find(
			{ $text: { $search: `${trimmedKeyword}` }, visibility: 0 },
			{ score: { $meta: "textScore" }, title: 5, description: 100, tags: 4 }
		)
		.sort({ score: { $meta: 'textScore' } })
		.limit(20)
		.select('-status -video_key -manifest_key -__v');

	res.json({
		count: searchedResults.length,
		searchedResults
	})
};

exports.updateVideoInfo = async function (req, res) {
	const { id: videoId, title, description, privacy, thumbnailIndex, tags } = req.body
	const { _id: userId, channelId } = req.user;

	try {
		const foundVideo = await Video.findOne(
			{ _id: videoId, author_id: userId }
		).select("+autogenerated_thumbnails_key");
		if (!foundVideo) return res.status(403).json({
			message: "Not allowed"
		});

		if (thumbnailIndex == 0) {
			const { fileKey: thumbnailKey } = await generateFileFromBuffer(req.files.thumbnailFile, userId, "thumbnails");
			await uploadToS3(thumbnailKey, val => val / 4 + 50 / 3 * (i + 1), channelId);
			foundVideo.thumbnail_key = thumbnailKey;
			removeRedundantFiles(thumbnailKey);
		}
		else {
			foundVideo.thumbnail_key = foundVideo.autogenerated_thumbnails_key[thumbnailIndex - 1];
		}
		foundVideo.title = title;
		foundVideo.description = description;
		if (tags) {
			foundVideo.tags = tags === '' ? [] : tags.split(",");
		}
		foundVideo.visibility = privacy;

		const updatedVideo = await foundVideo.save();
		res.json(updatedVideo);
	} catch (error) {
		console.log(error);
		res.status(500).json(error);
	}
}

exports.deleteVideoInfo = async function (req, res) {
	const { id: videoId } = req.body;
	const { _id: userId } = req.user;
	try {
		await Video.deleteOne({ _id: videoId, author_id: userId });
		res.sendStatus(204);
	} catch (error) {
		res.status(500).json(error);
	}
}

exports.getTotalViewsByVideoId = async function (req, res) {
	const { id } = req.params;
	try {
		const video = await Video.findById(id);
		if (video) {
			res.status(200).json(JSON.stringify(video.total_views));
		}
	} catch (error) {
		res.status(500).json(error);
	}
}

exports.increaseView = async function (req, res) {
	const { _id: viewerId } = req.user;
	const { id: videoId } = req.params
	const today = new Date(Date.now())
	const formattedToday = `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`

	try {
		const foundAccount = await Account.findOne(
			{ user_id: viewerId }
		);
		if (!foundAccount) return res.status(401).json("Channel does not exist")

		const foundWatchHistoryDate = await WatchHistoryDate.findOne(
			{ account_id: foundAccount._id, date: formattedToday }
		)
		let watchHistoryDate;
		if (!foundWatchHistoryDate) {
			const newWatchHistoryDate = await WatchHistoryDate.create({
				account_id: foundAccount._id, date: formattedToday, videos: [videoId]
			});
			await Account.updateOne(
				{ _id: foundAccount._id },
				{ $addToSet: { watched_history: newWatchHistoryDate } },
				{ new: true }
			);
			watchHistoryDate = newWatchHistoryDate;
		}
		else {
			const updatedWatchHistoryDate = await WatchHistoryDate.updateOne(
				{ account_id: foundAccount._id, date: formattedToday },
				{ $addToSet: { videos: videoId } }
			)
			watchHistoryDate = updatedWatchHistoryDate;
		}
		await Video.findOneAndUpdate(
			{ _id: videoId },
			{
				$addToSet: { views: foundAccount._id }
			},
			{ new: true }
		).select('+views')
		res.status(200).json({ watchHistoryDate });
	}
	catch (error) {
		console.log(error)
		res.status(500).json(error);
	}
}

exports.getWatchHistory = async function (req, res) {
	const { _id: userId } = req.user;

	try {
		const account = await Account.findOne({ user_id: userId }).populate({
			path: 'watched_history',
			populate: {
				path: 'videos',
				populate: 'author_id'
			}
		});

		const watchedHistoryDates = await Promise.all(account.watched_history.map(async function (historyDateDoc) {
			const formattedHistoryDateDoc = { ...historyDateDoc._doc };
			formattedHistoryDateDoc.videos = await Promise.all(formattedHistoryDateDoc.videos.map(async function (videoDoc) {
				const formattedVideoDoc = { ...videoDoc._doc }
				formattedVideoDoc.thumbnail_url = getSignedUrl({ key: formattedVideoDoc.thumbnail_key });
				formattedVideoDoc.url = getSignedUrl({ key: formattedVideoDoc.video_key });
				delete formattedVideoDoc.video_key;
				delete formattedVideoDoc.thumbnail_key;

				const authorAccount = await Account.findOne({ user_id: formattedVideoDoc.author_id });
				const authorUserInfo = await User.findOne({ _id: formattedVideoDoc.author_id });
				formattedVideoDoc.user = { ...formattedVideoDoc.author_id, username: authorAccount.username, channel_id: authorAccount._id, avatar: authorUserInfo.avatar };
				delete formattedVideoDoc.author_id;
				return formattedVideoDoc;
			}))
			return formattedHistoryDateDoc;
		}))
		watchedHistoryDates.sort((a, b) => b.created_at - a.created_at)

		res.status(200).json({ watchedHistoryDates });
	}
	catch (error) {
		console.log(error)
		res.status(500).json(error);
	}
}

exports.getWatchLaterVideos = async function (req, res) {
	const { channelId } = req.user;

	try {
		const channel = await Account.findOne({ _id: channelId }).populate({
			path: 'watch_later_videos',
			populate: 'author_id'
		});
		const videos = channel.watch_later_videos.map(((videoDoc) => {
			const formattedVideoDoc = { ...videoDoc._doc }
			formattedVideoDoc.thumbnail_url = getSignedUrl({ key: formattedVideoDoc.thumbnail_key });
			formattedVideoDoc.url = getSignedUrl({ key: formattedVideoDoc.video_key });
			formattedVideoDoc.user = { ...formattedVideoDoc.author_id, username: channel.username, channel_id: channel._id, avatar: channel.avatar };

			delete formattedVideoDoc.video_key;
			delete formattedVideoDoc.thumbnail_key;
			delete formattedVideoDoc.author_id;
			return formattedVideoDoc;
		}))

		res.json({ videos })
	}
	catch (error) {
		console.log(error)
		res.status(500).json(error);
	}
}

exports.watchLater = async function (req, res) {
	const { channelId } = req.user;
	const { videoId } = req.params;

	try {
		const foundVideo = await Video.findOne({ _id: videoId });
		if (!foundVideo) return res.status(400).json({
			message: "Video id not found"
		});

		await Account.findOneAndUpdate(
			{ _id: channelId },
			{ $addToSet: { watch_later_videos: foundVideo._id } }
		);
		return res.json({
			video: foundVideo
		})
	}
	catch (error) {
		console.log(error)
		res.status(500).json(error);
	}
}

exports.removeWatchLaterVideo = async function (req, res) {
	const { channelId } = req.user;
	const { videoId } = req.params;

	try {
		const foundVideo = await Video.findOne({ _id: videoId });
		if (!foundVideo) return res.status(400).json({
			message: "Video id not found"
		});

		await Account.findOneAndUpdate(
			{ _id: channelId },
			{ $pull: { watch_later_videos: foundVideo._id } }
		);
		return res.json({
			video: foundVideo
		})
	}
	catch (error) {
		console.log(error)
		res.status(500).json(error);
	}
}

exports.getAllVideoTags = async function (req, res) {
	const videoTags = Object.values(VideoTag);
	res.json({ tags: videoTags });
}

const _findAuthUserFeed = async function (followings) {
	const randomFollowingChannels = _.sampleSize(followings, AUTH_RANDOM_FOLLOW_CHANNELS);
	const followingsUserId = await Promise.all(randomFollowingChannels.map(async (channelId) => {
		const channel = await Account.findOne({ _id: channelId });
		return channel.user_id;
	}));

	const followingVideosCount = AUTH_FOLLOW_EACH_CHANNEL * followings.length;

	const randomFollowingVideos = await Video.aggregate([
		{ $match: { author_id: { $in: followingsUserId }, visibility: 0 } },
		{ $sample: { size: followingVideosCount } }
	]);
	const restVideos = await Video.aggregate([
		{ $match: { visibility: 0 } },
		{ $sample: { size: ONE_FETCH - followingVideosCount } }
	]);
	return [...randomFollowingVideos, ...restVideos];
}

const _findAnonymusUserFeed = async function () {
	const topViewVideos = await Video.find({
		visibility: 0
	}).sort({ total_views: -1 }).limit(20);
	const tempViewVideos = _.shuffle(topViewVideos);
	console.log("get top view");

	const topLikeVideos = await Video.find({
		visibility: 0
	}).sort({ total_likes: -1 }).limit(20);
	console.log("get top like");
	const tempLikeVideos = _.shuffle(topLikeVideos);

	const restVideos = await Video.aggregate([
		{ $match: { visibility: 0 } },
		{ $sample: { size: ONE_FETCH - TOP_VIEW_ANONYMUS_ONE_FETCH - TOP_LIKE_ANONYMUS_ONE_FETCH } }
	]);
	console.log("get rest");

	return [
		...tempViewVideos.slice(0, TOP_LIKE_ANONYMUS_ONE_FETCH),
		...tempLikeVideos.slice(0, TOP_LIKE_ANONYMUS_ONE_FETCH),
		...restVideos
	];
}

exports.getFeed = async function (req, res, next) {
	console.log("get feed")
	let videos = [];
	try {
		if (req.user && req.user.channelId) {
			const channel = await Account.findOne({ _id: req.user.channelId }).select("+followings");
			videos = !!channel ? await _findAuthUserFeed(channel.followings) : await _findAnonymusUserFeed();
		}
		else {
			videos = await _findAnonymusUserFeed()
		}
		const formattedVideos = await Promise.all(videos.map(async function (video) {
			const formattedVideo = await formatVideo(!!video._doc ? video._doc : video);
			return formattedVideo;
		}));
		res.json({ videos: formattedVideos });
	}
	catch (err) {
		next(err);
	}

}

exports.getVideoSuggestion = async function (req, res) {
	console.log("get video suggestion")
	const NUMBER_VIDEOS_OF_AUTHOR = 12;
	const NUMBER_RELATED_VIDEOS = 12;

	const { id } = req.params;

	const video = await Video.findOne({ _id: id });

	const otherVideosOfAuthor = await Video.aggregate([
		{ $match: { visibility: 0, author_id: video.author_id } },
		{ $sample: { size: NUMBER_VIDEOS_OF_AUTHOR } }
	]);
	const formattedOtherVideosOfAuthor = await Promise.all(otherVideosOfAuthor.map(async function (video) {
		const formattedVideo = await formatVideo(video);
		return formattedVideo;
	}));

	const relatedVideos = await Video.aggregate([
		{
			$match: {
				visibility: 0,
				tags: {
					$elemMatch: {
						$in: video.tags
					}
				}
			},
		},
		{ $sample: { size: NUMBER_RELATED_VIDEOS }, },
	]);
	const formattedRelatedVideos = await Promise.all(relatedVideos.map(async function (video) {
		const formattedVideo = await formatVideo(video);
		return formattedVideo;
	}));

	res.json({
		otherVideosOfAuthor: formattedOtherVideosOfAuthor,
		relatedVideos: formattedRelatedVideos
	});
}