var mongoose = require('mongoose');
var common = require('./common');
var queryParams = require('./query');
var Task = require('../models/task');
var User = require('../models/user');

var castDate = mongoose.Schema.Types.Date.cast();
var castBoolean = mongoose.Schema.Types.Boolean.cast();

// Use Mongoose's own casting so the check accepts exactly what the schema would store
function canCast(cast, value) {
    try {
        return cast(value) != null;
    } catch (err) {
        return false;
    }
}

// Count null as missing so the field falls back to its default
function isOptionalString(value) {
    return value == null || typeof value === 'string';
}

function validateTask(body) {
    if (!common.isFilledString(body.name)) {
        return 'Task name is required';
    }
    if (!canCast(castDate, body.deadline)) {
        return 'Task deadline is required and must be a valid date';
    }
    if (body.completed != null && !canCast(castBoolean, body.completed)) {
        return 'Task completed must be true or false';
    }
    if (!isOptionalString(body.description)) {
        return 'Task description must be text';
    }
    if (!isOptionalString(body.assignedUser) || !isOptionalString(body.assignedUserName)) {
        return 'Task assigned user must be text';
    }
    if (body.assignedUser && !mongoose.isObjectIdOrHexString(body.assignedUser)) {
        return 'Task assigned user must be a valid user id';
    }
    return null;
}

// Fill every field so PUT replaces the whole task, ignoring _id and dateCreated in the body
function taskFields(body) {
    return {
        name: body.name,
        description: body.description ?? '',
        deadline: body.deadline,
        completed: body.completed ?? false,
        assignedUser: body.assignedUser ?? '',
        assignedUserName: body.assignedUserName ?? null,
    };
}

// Fill in assignedUserName from the assigned user, returning an error when the two disagree
async function resolveAssignee(fields) {
    if (fields.assignedUser === '') {
        if (fields.assignedUserName !== null && fields.assignedUserName !== 'unassigned') {
            return { status: 400, message: 'An unassigned task must have assignedUserName "unassigned"' };
        }
        fields.assignedUserName = 'unassigned';
        return null;
    }
    var user = await User.findById(fields.assignedUser);
    if (!user) {
        return { status: 404, message: 'Assigned user not found' };
    }
    if (fields.assignedUserName !== null && fields.assignedUserName !== user.name) {
        return { status: 400, message: 'assignedUserName does not match the assigned user' };
    }
    fields.assignedUserName = user.name;
    return null;
}

function removeFromPendingTasks(taskId) {
    return User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } });
}

// Pull the task from every user, then give it back to its assigned user only while it is pending
async function syncPendingTasks(task) {
    var taskId = String(task._id);
    await removeFromPendingTasks(taskId);
    if (task.assignedUser !== '' && !task.completed) {
        await User.updateOne({ _id: task.assignedUser }, { $addToSet: { pendingTasks: taskId } });
    }
}

module.exports = function (router) {
    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    tasksRoute.get(async function (req, res) {
        var query;
        try {
            query = queryParams.buildListQuery(Task, req.query, 100);
        } catch (err) {
            return common.sendInvalidQuery(res);
        }
        try {
            var tasks = await query;
            res.status(200).json({ message: 'OK', data: tasks });
        } catch (err) {
            common.sendQueryError(res, err);
        }
    });

    tasksRoute.post(async function (req, res) {
        try {
            if (req.bodyParseFailed) {
                return common.sendInvalidBody(res);
            }
            // Express leaves the body undefined when the request has none
            var body = req.body ?? {};
            var error = validateTask(body);
            if (error) {
                return res.status(400).json({ message: error, data: {} });
            }
            var fields = taskFields(body);
            var assigneeError = await resolveAssignee(fields);
            if (assigneeError) {
                return res.status(assigneeError.status).json({ message: assigneeError.message, data: {} });
            }
            // Write the task and its user updates together so a failure leaves nothing half done
            var task = await mongoose.connection.transaction(async function () {
                var createdTask = await Task.create(fields);
                await syncPendingTasks(createdTask);
                return createdTask;
            });
            res.status(201).json({ message: 'Task created', data: task });
        } catch (err) {
            common.sendServerError(res);
        }
    });

    taskRoute.get(async function (req, res) {
        // Check the id before select so a missing task gets 404 even with a bad select
        try {
            if (!(await common.existsById(Task, req.params.id))) {
                return res.status(404).json({ message: 'Task not found', data: {} });
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
            var task = await Task.findById(req.params.id, select);
            res.status(200).json({ message: 'OK', data: task });
        } catch (err) {
            common.sendQueryError(res, err);
        }
    });

    taskRoute.put(async function (req, res) {
        try {
            var task = await common.findById(Task, req.params.id);
            if (!task) {
                return res.status(404).json({ message: 'Task not found', data: {} });
            }
            if (req.bodyParseFailed) {
                return common.sendInvalidBody(res);
            }
            var body = req.body ?? {};
            var error = validateTask(body);
            if (error) {
                return res.status(400).json({ message: error, data: {} });
            }
            var fields = taskFields(body);
            var assigneeError = await resolveAssignee(fields);
            if (assigneeError) {
                return res.status(assigneeError.status).json({ message: assigneeError.message, data: {} });
            }
            task.set(fields);
            await mongoose.connection.transaction(async function () {
                await task.save();
                await syncPendingTasks(task);
            });
            res.status(200).json({ message: 'Task updated', data: task });
        } catch (err) {
            common.sendServerError(res);
        }
    });

    taskRoute.delete(async function (req, res) {
        try {
            var task = await common.findById(Task, req.params.id);
            if (!task) {
                return res.status(404).json({ message: 'Task not found', data: {} });
            }
            await mongoose.connection.transaction(async function () {
                await task.deleteOne();
                await removeFromPendingTasks(String(task._id));
            });
            res.status(200).json({ message: 'Task deleted', data: task });
        } catch (err) {
            common.sendServerError(res);
        }
    });

    return router;
};
