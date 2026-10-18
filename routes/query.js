// Parse a where, sort or select parameter, leaving it undefined when absent
function parseObject(value) {
    if (value === undefined) {
        return undefined;
    }
    var parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Query parameter must be a JSON object');
    }
    return parsed;
}

function parseCount(value) {
    if (value === undefined || value === 'false') {
        return false;
    }
    if (value === 'true') {
        return true;
    }
    throw new Error('count must be true or false');
}

function parseWholeNumber(value) {
    if (value === undefined) {
        return undefined;
    }
    if (!/^\d+$/.test(value)) {
        throw new Error('skip and limit must be whole numbers');
    }
    return Number(value);
}

// Build the find or count query, throwing on any client value Mongoose rejects before it runs
function buildListQuery(model, params, defaultLimit) {
    var where = parseObject(params.where) ?? {};
    var skip = parseWholeNumber(params.skip);
    var limit = parseWholeNumber(params.limit);
    var query;
    if (parseCount(params.count)) {
        query = model.countDocuments(where);
    } else {
        query = model
            .find(where)
            .sort(parseObject(params.sort))
            .select(parseObject(params.select));
        // Apply the default limit only to find so count still counts every match
        limit = limit ?? defaultLimit;
    }
    if (skip !== undefined) {
        query.skip(skip);
    }
    // Leave out a limit of 0 since find reads it as no limit but count rejects it
    if (limit) {
        query.limit(limit);
    }
    // Cast the filter now so a bad value like a malformed id throws here instead of when the query runs
    query.cast();
    return query;
}

module.exports = { parseObject, buildListQuery };
