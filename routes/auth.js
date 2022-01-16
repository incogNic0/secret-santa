const express = require("express");
const router = express.Router();
const passport = require("passport");
const { catchAsync, ExpressError } = require("../helpers/errors");
const { sendEmailLink } = require('../helpers/email');

const User = require("../models/User");
const Link = require('../models/Link');
const {
  isLoggedIn,
  isValidLinkReset
} = require("../middleware/validators");

const { 
  validRegistration,
  validEmail,
  validPassUpdate,
  validPassReset
} = require("../middleware/joiSchemas");


router.get("/register", async (req, res) => {
	res.render("auth/register");
});



router.post(
	"/register",
	validRegistration,
	catchAsync( async (req, res, next) => {
		const { email, displayName, password } = req.body.newUser;
		const newUser = new User({ email: email.toLowerCase(), displayName });
		const user = await User.register(newUser, password);

		req.login(user, async (err) => {
			if (err) return next(err);

			const redirect = req.session.redirectedFrom || `/users/${user.id}`;
			delete req.session.redirectedFrom;

      const details = await sendEmailLink(user, 'emailConfirm');
      const newLink = new Link(details);
      await newLink.save();

      req.flash("success", "Welcome! Please check your messages and confirm your email address.");
			return res.redirect(redirect);
		});
	})
);



router.get("/login", (req, res) => {
	res.render("auth/login");
});



router.post(
	"/login",
	passport.authenticate("local", {
		failureFlash: true,
		failureRedirect: "login",
	}),
	(req, res) => {
		const redirection = req.session.redirectedFrom || `/users/${req.user.id}`;
		delete req.session.redirectedFrom;
		req.flash("success", "Welcome back!");
		res.redirect(redirection);
	}
);



router.get("/logout", (req, res) => {
	req.logout();
	req.flash("success", "Successfully logged out!");
	res.redirect("login");
});



router.get(
	"/google",
	passport.authenticate("google", {
		scope: ["profile", "email"],
	})
);



router.get(
	"/google/callback",
	passport.authenticate("google", {
		failureFlash: true,
		failureRedirect: "login",
	}),
	(req, res) => {
		const redirection = req.session.redirectedFrom || `/users/${req.user.id}`;
		delete req.session.redirectedFrom;
    if(req.user.email && !req.user.verified) {
      req.flash("success", "Welcome! Please check your messages and confirm your email address.");
    } else {
      req.flash("success", "Welcome back!");
    }
		res.redirect(redirection);
	}
);



router.get(
  '/confirmation/email',
  isLoggedIn,
  catchAsync( async(req, res, next) => {
  const code = req.query.ulc;
  const link = await Link.findOneAndUpdate({ code }, {valid: false, expireAt: Date.now()});

    if(!link || link.referenceID !== req.user.id) {
      const msg = 'Unable to verify email. Please try again or request a new link.'
      throw new ExpressError(msg, 400, `/users/${req.user.id}`);
    }

    const user = await User.findById(req.user.id);
    user.verified = true;
    await user.save();

    req.flash('success', 'Thank you! Email has been verified.');
    
    res.redirect(`/users/${req.user.id}`)
}));



router.post(
  '/confirmation/email',
  isLoggedIn,
  catchAsync( async(req, res, next) => {
    const { id } = req.body;
    const user = await User.findById(id);

    if (!user || user.verified) 
      throw new ExpressError('Email is either not registered or already confirmed.', 400);

    const details = await sendEmailLink(user, 'emailConfirm');
    const newLink = new Link(details);
    await newLink.save();
      
    req.flash('success', 'A confirmation email has been sent.  Please check your spam folder if you do not see it in your inbox.')
    
    res.redirect(`/users/${id}`);
}));

// ---- UPDATE PASSWORD ----
router.get('/password/update', isLoggedIn, (req, res) => {
  res.render('auth/update');
});

router.put(
  '/password/update',
  isLoggedIn, validPassUpdate,
  catchAsync( async (req, res, next) => {
    const { currentPass, password } = req.body;
    const user = await User.findById(req.user.id);
    
    await user.changePassword(currentPass, password);
    await user.save();

    req.flash('success', 'Successfully updated password');
    res.redirect(`/auth/${user.id}`);
  }));


// ----- RESET PASSWORD ------
router.get('/password/reset/request', (req,res) => {
  res.render('auth/reset');
});

// Update password - forgot password
router.get('/password/reset/update',
isValidLinkReset,
(req, res) => {
  const { ulc } = req.query;
  res.render('auth/update', {ulc});
});

router.post('/password/reset',
  validEmail,
  catchAsync( async(req, res, next) => {
    const user = await User.findOne({email: req.body.email});

    if(!user || !user.verified || user.googleID) {
      const msg = 'Cannot reset password.  Email is not registered, or is associated with an alternative login method.';
      throw new ExpressError(msg, 400, '/auth/login');
    }

    const details = await sendEmailLink(user, 'resetRequest');
    const newLink = new Link(details);
    await newLink.save();

    req.flash('success', 'A message has been sent to the email address.  Please check your spam folder if you do not see it in your inbox.');

    res.redirect('/auth/login');
}));

router.put(
  '/password/reset/update',
  isValidLinkReset, validPassReset,
  catchAsync( async(req, res, next) => {
    const code = req.body.ulc;
    const link = await Link.findOneAndUpdate({ code }, {valid: false, expireAt: Date.now()});
  
    const user = await User.findById( link.referenceID );
    if(!user) {
      const msg = 'Unable to update password.'
      throw new ExpressError(msg, 400, '/auth/login')
    }
    
    await user.setPassword(req.body.password);
    await user.save();

    req.flash('success', 'Successfully updated password');
    res.redirect('/auth/login');
}));


module.exports = router;
