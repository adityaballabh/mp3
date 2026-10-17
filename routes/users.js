var mongoose = require('mongoose');
var common = require('./common');
var queryParams = require('./query');
var Task = require('../models/task');
var User = require('../models/user');

function areTaskIds(values) {
    for (var value of values) {
        if (!mongoose.isObjectIdOrHexString(value)) {
            return false;
        }
    }
    return true;
}

function validateUser(body) {
    if (!common.isFilledString(body.name)) {
        return 'User name is required';
    }
    if (!common.isFilledString(body.email)) {
        return 'User email is required';
    }
    if (body.pendingTasks != null && !Array.isArray(body.pendingTasks)) {
        return 'User pendingTasks must be a list';
    }
    if (body.pendingTasks != null && !areTaskIds(body.pendingTasks)) {
        return 'User pendingTasks must contain valid task ids';
    }
    return null;
}

// Pick only client-settable fields so _id and dateCreated in the body are ignored
function userFields(body) {
    return {
        name: body.name,
        email: body.email,
        // Drop repeated ids so each task is listed once
        pendingTasks: [...new Set(body.pendingTasks ?? [])],
    };
}

// Check that every listed task exists and is still pending
async function checkPendingTasks(taskIds) {
    var tasks = await Task.find({ _id: { $in: taskIds } }, { completed: 1 });
    if (tasks.length !== taskIds.length) {
        return { status: 404, message: 'A task in pendingTasks does not exist' };
    }
    for (var task of tasks) {
        if (task.completed) {
            return { status: 400, message: 'A completed task cannot be in pendingTasks' };
        }
    }
    return null;
}

function unassignTasks(filter) {
    return Task.updateMany(filter, { assignedUser: '', assignedUserName: 'unassigned' });
}

// Point tasks at the user's new pendingTasks, moving any that belonged to another user
async function syncAssignedTasks(user, oldTaskIds) {
    var userId = String(user._id);
    var newTaskIds = user.pendingTasks.toObject();
    var droppedTaskIds = oldTaskIds.filter(function (taskId) {
        return !newTaskIds.includes(taskId);
    });
    await unassignTasks({ _id: { $in: droppedTaskIds }, assignedUser: userId });
    await User.updateMany(
        { _id: { $ne: user._id }, pendingTasks: { $in: newTaskIds } },
        { $pull: { pendingTasks: { $in: newTaskIds } } },
    );
    // Also refresh the name on tasks the user already had, completed ones included
    await Task.updateMany(
        { $or: [{ _id: { $in: newTaskIds } }, { assignedUser: userId }] },
        { assignedUser: userId, assignedUserName: user.name },
    );
}

async function isEmailTaken(email, ownId) {
    var query = { email: email };
    if (ownId) {
        query._id = { $ne: ownId };
    }
    return User.exists(query);
}

function sendEmailTaken(res) {
    res.status(400).json({
        message: 'A user with this email already exists',
        data: {},
    });
}

// Catch a duplicate email that slipped past isEmailTaken when two requests race
function sendSaveError(res, err) {
    if (err.code === 11000) {
        return sendEmailTaken(res);
    }
    common.sendServerError(res);
}

module.exports = function (router) {
    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    usersRoute.get(async function (req, res) {
        var query;
        try {
            query = queryParams.buildListQuery(User, req.query);
        } catch (err) {
            return common.sendInvalidQuery(res);
        }
        try {
            var users = await query;
            res.status(200).json({ message: 'OK', data: users });
        } catch (err) {
            common.sendQueryError(res, err);
        }
    });

    usersRoute.post(async function (req, res) {
        try {
            if (req.bodyParseFailed) {
                return common.sendInvalidBody(res);
            }
            // Express leaves the body undefined when the request has none
            var body = req.body ?? {};
            var error = validateUser(body);
            if (error) {
                return res.status(400).json({ message: error, data: {} });
            }
            if (await isEmailTaken(body.email)) {
                return sendEmailTaken(res);
            }
            var fields = userFields(body);
            var taskError = await checkPendingTasks(fields.pendingTasks);
            if (taskError) {
                return res.status(taskError.status).json({ message: taskError.message, data: {} });
            }
            // Write the user and its task updates together so a failure leaves nothing half done
            var user = await mongoose.connection.transaction(async function () {
                var createdUser = await User.create(fields);
                await syncAssignedTasks(createdUser, []);
                return createdUser;
            });
            res.status(201).json({ message: 'User created', data: user });
        } catch (err) {
            sendSaveError(res, err);
        }
    });

    userRoute.get(async function (req, res) {
        // Check the id before select so a missing user gets 404 even with a bad select
        try {
            if (!(await common.existsById(User, req.params.id))) {
                return res.status(404).json({ message: 'User not found', data: {} });
            }
        } catch (err) {
            return common.sendServerError(res);
        }
        var select;
        try {
            select = queryParams.parseObject(req.query.select);
        } catch (err) {
            return common.sendInvalidQuery(res);
        }
        try {
            var user = await User.findById(req.params.id, select);
            res.status(200).json({ message: 'OK', data: user });
        } catch (err) {
            common.sendQueryError(res, err);
        }
    });

    userRoute.put(async function (req, res) {
        try {
            var user = await common.findById(User, req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'User not found', data: {} });
            }
            if (req.bodyParseFailed) {
                return common.sendInvalidBody(res);
            }
            var body = req.body ?? {};
            var error = validateUser(body);
            if (error) {
                return res.status(400).json({ message: error, data: {} });
            }
            if (await isEmailTaken(body.email, user._id)) {
                return sendEmailTaken(res);
            }
            var fields = userFields(body);
            var taskError = await checkPendingTasks(fields.pendingTasks);
            if (taskError) {
                return res.status(taskError.status).json({ message: taskError.message, data: {} });
            }
            var oldTaskIds = user.pendingTasks.toObject();
            user.set(fields);
            await mongoose.connection.transaction(async function () {
                await user.save();
                await syncAssignedTasks(user, oldTaskIds);
            });
            res.status(200).json({ message: 'User updated', data: user });
        } catch (err) {
            sendSaveError(res, err);
        }
    });

    userRoute.delete(async function (req, res) {
        try {
            var user = await common.findById(User, req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'User not found', data: {} });
            }
            await mongoose.connection.transaction(async function () {
                await user.deleteOne();
                await unassignTasks({ assignedUser: String(user._id) });
            });
            res.status(204).end();
        } catch (err) {
            common.sendServerError(res);
        }
    });

    return router;
};
