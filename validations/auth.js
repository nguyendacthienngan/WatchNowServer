const Joi = require('joi');

const registerValidator = (data) => {
    const rule = Joi.object({
        username: Joi.string().min(6).max(225).required(),
        email: Joi.string().min(6).max(225).required().email(),
        password: Joi.string().pattern(new RegExp('^[a-zA-Z0-9]{6,20}$')).required(),
        first_name: Joi.string().required(),
        last_name: Joi.string().required()
    })

    return rule.validate(data);
}

module.exports.registerValidator = registerValidator;