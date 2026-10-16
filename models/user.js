// Load required packages
var mongoose = require('mongoose');

// Define our user schema
var UserSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        pendingTasks: { type: [String], default: [] },
        dateCreated: { type: Date, immutable: true },
    },
    { versionKey: false },
);

// Stamp the creation time on the server so a client value is ignored
UserSchema.pre('save', function () {
    if (this.isNew) {
        this.dateCreated = Date.now();
    }
});

// Export the Mongoose model
module.exports = mongoose.model('User', UserSchema);
