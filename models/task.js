// Load required packages
var mongoose = require('mongoose');

// Define our task schema
var TaskSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        description: { type: String, default: '' },
        deadline: { type: Date, required: true },
        completed: { type: Boolean, default: false },
        assignedUser: { type: String, default: '' },
        assignedUserName: { type: String, default: 'unassigned' },
        dateCreated: { type: Date, immutable: true },
    },
    { versionKey: false },
);

// Stamp the creation time on the server so a client value is ignored
TaskSchema.pre('save', function () {
    if (this.isNew) {
        this.dateCreated = Date.now();
    }
});

// Export the Mongoose model
module.exports = mongoose.model('Task', TaskSchema);
