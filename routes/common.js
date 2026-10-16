var mongoose = require('mongoose');

// Treat malformed ids as missing so lookups give 404 instead of a cast error
async function findById(model, id) {
    if (!mongoose.isObjectIdOrHexString(id)) {
        return null;
    }
    return model.findById(id);
}

function isFilledString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function sendInvalidBody(res) {
    res.status(400).json({
        message: 'Request body is not valid JSON',
        data: {},
    });
}

function sendServerError(res) {
    res.status(500).json({
        message: 'Something went wrong on the server',
        data: {},
    });
}

module.exports = { findById, isFilledString, sendInvalidBody, sendServerError };
