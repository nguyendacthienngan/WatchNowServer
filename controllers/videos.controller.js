const { uploadFile, getFileStream, getFile } = require('../utils/aws-s3-handlers')
const { videosConvertToAudio } = require('../utils/convert-videos-to-audio')
const Video = require('../models/videos');
const fs = require('fs')
  
exports.getVideoById = function (req, res) {
    const key = req.params.key
    const readStream = getFileStream(key)
    readStream.pipe(res);
    // This catches any errors that happen while creating the readable stream (usually invalid names)
    readStream.on('error', function(err) {
        res.end(err);
    });
};

exports.uploadVideo = async function (req, res) {
    const file = req.files.video
    const body = req.body
    audioRecognition(file)

    // apply filter
    // resize

    // saveVideoToDatabase(file, body)
}

async function saveVideoToDatabase (file, body) {
    const size = file.size
    const title = body.title
    const description = body.description

    const reqVideo = {
        "title": title,
        "size": size,
        "description": description,
        "url": "test-url"
    }
    if (file) {
        const result = await uploadFile(file)
        console.log(result)
        res.status(200)
        // store result.Key in url video
        const key = result.Key
        reqVideo.url = key
        const newVideo = new Video(reqVideo);
        newVideo.save(function (err) {
            if(err) {
            res.status(400).send(err);
            } else {
                res.send(newVideo)
            }
        });
    }
}

function audioRecognition(file) {
    videoAnalysis(file)
}

async function videoAnalysis(file){
    const dataBuffers = file.data
    const name = file.name
    // Check same name?
    const videoSavedPath = './videos/' + name
    const audioSavedPath = './audios/' + name.split('.')[0] + '.mp3'; 
    // console.log(audioSavedPath)

    fs.writeFile(videoSavedPath, dataBuffers, function(err){
        if (err) return console.log(err);
        console.log("Saved " + videoSavedPath);
        console.log("Converting to " + audioSavedPath)
        videosConvertToAudio(videoSavedPath, audioSavedPath, function(err){
            if(!err) {
                //...
                
            }
        })
    })
}