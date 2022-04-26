const S3 = require('aws-sdk/clients/s3');
const fs = require('fs');

const { AWS_BUCKET_NAME, AWS_BUCKET_REGION, AWS_ACCESS_KEY, AWS_SECRET_KEY } = process.env

const s3 = new S3({
	region: AWS_BUCKET_REGION,
	accessKeyId: AWS_ACCESS_KEY,
	secretAccessKey: AWS_SECRET_KEY
});

// uploads a file to s3
exports.uploadFile = function (fileName, fileStream) {
	// Binary data base64
	// const { base } = path.parse(newFilePath);
	// const fileName = base;
	// const newFileBuffer = fs.readFileSync(newFilePath);
	// const fileStream  = Buffer.from(newFileBuffer, 'binary');
	const extension = fileName.split('.')[fileName.split('.').length - 1];
	const folder = extension === 'mp3' ? 'audios' : extension === 'mp4' ? 'videos' : 'thumbnails';
	const uploadParams = {
		Bucket: AWS_BUCKET_NAME,
		Body: fileStream,
		Key: folder + '/' + fileName
	};
	return s3.upload(uploadParams, function (err, data) {
		if (err) {
			return false;
		}
		return true;
	});
}

// downloads a file from s3
exports.getFileStream = async function (fileKey) {
	const downloadParams = {
		Key: fileKey,
		Bucket: AWS_BUCKET_NAME
	}
	return new Promise(async function (resolve, reject) {
		try {
			await s3.headObject(downloadParams).promise();
			try {
				const result = s3.getObject(downloadParams).createReadStream()
				if (result)
					resolve(result);
				else
					reject("Cannot get video");
			} catch (err) {
				console.log(err)
				reject(err)
			}
		} catch (err) {
			console.log("File not Found ERROR : " + err.code);
			reject(err);
		}
	});
}

exports.deleteFile = function (fileKey) {
	const deleteParams = {
		Key: fileKey,
		Bucket: AWS_BUCKET_NAME
	}
	return new Promise(async function (resolve, reject) {
		try {
			await s3.headObject(deleteParams).promise();
			try {
				const result = await s3.deleteObject(deleteParams).promise();
				if (result)
					resolve(result);
				else
					reject("Cannot delete video");
			} catch (error) {
				console.log("Cannot delete video, error: ", error);
				reject(error);
			}
		} catch (error) {
			console.log("Cannot find video, error: ", error);
			reject(error);
		}
	});
}

exports.getSignedUrl = function ({ key, expires }) {
	const signedUrl = s3.getSignedUrl('getObject', {
		Key: key,
		Bucket: AWS_BUCKET_NAME,
		Expires: expires || 900000, // S3 default is 900 seconds (15 minutes)
	})
	return signedUrl;
}
