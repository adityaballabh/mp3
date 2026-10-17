var mongoose = require('mongoose');

// Treat malformed ids as missing so lookups give 404 instead of a cast error
async function findById(model, id) {
    if (!mongoose.isObjectIdOrHexString(id)) {
        return null;
    }
    return model.findById(id);
}

async function existsById(model, id) {
    if (!mongoose.isObjectIdOrHexString(id)) {
        return false;
    }
    return (await model.exists({ _id: id })) !== null;
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

function sendInvalidQuery(res) {
    res.status(400).json({
        message: 'Query parameters are not valid',
        data: {},
    });
}

// MongoDB rejecting the query means a bad client value like a mixed select, anything else is on the server
function sendQueryError(res, err) {
    if (err.name === 'MongoServerError') {
        return sendInvalidQuery(res);
    }
    sendServerError(res);
}

module.exports = {
    existsById,
    findById,
    isFilledString,
    sendInvalidBody,
    sendInvalidQuery,
    sendQueryError,
    sendServerError,
};
