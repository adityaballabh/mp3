var mongoose = require('mongoose');
var common = require('./common');
var Task = require('../models/task');

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
        assignedUserName: body.assignedUserName ?? 'unassigned',
    };
}

module.exports = function (router) {
    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    tasksRoute.get(async function (req, res) {
        try {
            var tasks = await Task.find();
            res.status(200).json({ message: 'OK', data: tasks });
        } catch (err) {
            common.sendServerError(res);
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
            var task = await Task.create(taskFields(body));
            res.status(201).json({ message: 'Task created', data: task });
        } catch (err) {
            common.sendServerError(res);
        }
    });

    taskRoute.get(async function (req, res) {
        try {
            var task = await common.findById(Task, req.params.id);
            if (!task) {
                return res.status(404).json({ message: 'Task not found', data: {} });
            }
            res.status(200).json({ message: 'OK', data: task });
        } catch (err) {
            common.sendServerError(res);
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
            task.set(taskFields(body));
            await task.save();
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
            await task.deleteOne();
            res.status(200).json({ message: 'Task deleted', data: task });
        } catch (err) {
            common.sendServerError(res);
        }
    });

    return router;
};
