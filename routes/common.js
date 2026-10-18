var mongoose = require('mongoose');
var queryParams = require('./query');

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

function sendError(res, status, message) {
    res.status(status).json({ message: message, data: {} });
}

function sendPrepareError(res, error) {
    sendError(res, error.status, error.message);
}

function sendInvalidBody(res) {
    sendError(res, 400, 'Request body is not valid JSON');
}

function sendServerError(res) {
    sendError(res, 500, 'Something went wrong on the server');
}

function sendInvalidQuery(res) {
    sendError(res, 400, 'Query parameters are not valid');
}

// MongoDB rejecting the query means a bad client value, anything else is on the server
function sendQueryError(res, err) {
    if (err.name === 'MongoServerError') {
        return sendInvalidQuery(res);
    }
    sendServerError(res);
}

function listHandler(model, defaultLimit) {
    return async function (req, res) {
        var query;
        try {
            query = queryParams.buildListQuery(model, req.query, defaultLimit);
        } catch (err) {
            return sendInvalidQuery(res);
        }
        try {
            var documents = await query;
            res.status(200).json({ message: 'OK', data: documents });
        } catch (err) {
            sendQueryError(res, err);
        }
    };
}

function getByIdHandler(model, notFoundMessage) {
    return async function (req, res) {
        // Check the id before select so a missing document gets 404 even with a bad select
        try {
            if (!(await existsById(model, req.params.id))) {
                return sendError(res, 404, notFoundMessage);
            }
        } catch (err) {
            return sendServerError(res);
        }
        var select;
        try {
            select = queryParams.parseObject(req.query.select);
        } catch (err) {
            return sendInvalidQuery(res);
        }
        try {
            var document = await model.findById(req.params.id, select);
            res.status(200).json({ message: 'OK', data: document });
        } catch (err) {
            sendQueryError(res, err);
        }
    };
}

module.exports = {
    findById,
    getByIdHandler,
    isFilledString,
    listHandler,
    sendError,
    sendInvalidBody,
    sendServerError,
    sendPrepareError,
};
