const mongoose = require('mongoose');
const Schema = mongoose.Schema
const { commentSchema } = require('./comment.js')
const { likeSchema } = require('./like.js')

const schemaOptions = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

const Video = new Schema ({
    title: { type: String, required: true },
    url: { type: String, required: true },
    size: { type: Number, required: true },
    description: { type: String },
    recognitionResult: { type: Schema.Types.Mixed },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    comments: [commentSchema],
    likes: [likeSchema]
}, schemaOptions);

module.exports = mongoose.model('Video', Video)