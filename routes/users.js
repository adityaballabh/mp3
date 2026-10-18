var mongoose = require('mongoose');
var common = require('./common');
var Task = require('../models/task');
var User = require('../models/user');

var emailTakenMessage = 'A user with this email already exists';

function validateUser(body) {
    if (!common.isFilledString(body.name)) {
        return 'User name is required';
    }
    if (!common.isFilledString(body.email)) {
        return 'User email is required';
    }
    if (body.pendingTasks != null) {
        if (!Array.isArray(body.pendingTasks)) {
            return 'User pendingTasks must be a list';
        }
        if (!body.pendingTasks.every(mongoose.isObjectIdOrHexString)) {
            return 'User pendingTasks must contain valid task ids';
        }
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
    // Take the new tasks off any other user who still lists them
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

// Validate the body and build the user fields, returning the first error with its status
async function prepareUser(body, ownId) {
    var message = validateUser(body);
    if (message) {
        return { error: { status: 400, message: message } };
    }
    if (await isEmailTaken(body.email, ownId)) {
        return { error: { status: 400, message: emailTakenMessage } };
    }
    var fields = userFields(body);
    var taskError = await checkPendingTasks(fields.pendingTasks);
    if (taskError) {
        return { error: taskError };
    }
    return { fields: fields };
}

// Catch a duplicate email that slipped past isEmailTaken when two requests race
function sendSaveError(res, err) {
    if (err.code === 11000) {
        return common.sendError(res, 400, emailTakenMessage);
    }
    common.sendServerError(res);
}

module.exports = function (router) {
    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    usersRoute.get(common.listHandler(User));

    usersRoute.post(async function (req, res) {
        try {
            if (req.bodyParseFailed) {
                return common.sendInvalidBody(res);
            }
            // Express leaves the body undefined when the request has none
            var result = await prepareUser(req.body ?? {});
            if (result.error) {
                return common.sendPrepareError(res, result.error);
            }
            // Write the user and its task updates together so a failure leaves nothing half done
            var user = await mongoose.connection.transaction(async function () {
                var createdUser = await User.create(result.fields);
                await syncAssignedTasks(createdUser, []);
                return createdUser;
            });
            res.status(201).json({ message: 'User created', data: user });
        } catch (err) {
            sendSaveError(res, err);
        }
    });

    userRoute.get(common.getByIdHandler(User, 'User not found'));

    userRoute.put(async function (req, res) {
        try {
            var user = await common.findById(User, req.params.id);
            if (!user) {
                return common.sendError(res, 404, 'User not found');
            }
            if (req.bodyParseFailed) {
                return common.sendInvalidBody(res);
            }
            var result = await prepareUser(req.body ?? {}, user._id);
            if (result.error) {
                return common.sendPrepareError(res, result.error);
            }
            var oldTaskIds = user.pendingTasks.toObject();
            user.set(result.fields);
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
                return common.sendError(res, 404, 'User not found');
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
};
