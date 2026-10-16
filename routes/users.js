var common = require('./common');
var User = require('../models/user');

function validateUser(body) {
    if (!common.isFilledString(body.name)) {
        return 'User name is required';
    }
    if (!common.isFilledString(body.email)) {
        return 'User email is required';
    }
    return null;
}

// Pick only client-settable fields so _id and dateCreated in the body are ignored
function userFields(body) {
    return {
        name: body.name,
        email: body.email,
        pendingTasks: body.pendingTasks ?? [],
    };
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
        try {
            var users = await User.find();
            res.status(200).json({ message: 'OK', data: users });
        } catch (err) {
            common.sendServerError(res);
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
            var user = await User.create(userFields(body));
            res.status(201).json({ message: 'User created', data: user });
        } catch (err) {
            sendSaveError(res, err);
        }
    });

    userRoute.get(async function (req, res) {
        try {
            var user = await common.findById(User, req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'User not found', data: {} });
            }
            res.status(200).json({ message: 'OK', data: user });
        } catch (err) {
            common.sendServerError(res);
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
            user.set(userFields(body));
            await user.save();
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
            await user.deleteOne();
            res.status(200).json({ message: 'User deleted', data: user });
        } catch (err) {
            common.sendServerError(res);
        }
    });

    return router;
};
