const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');
const cookieParser = require('cookie-parser'); //express is featureless
const hbs = require('hbs');
const sha256 = require('js-sha256');

const settings = require('./settings');
const db = require('./db');
const regex = require('./xss');
const port = process.env.PORT || 3020;
let app = express();
db.init();
const guestPages = ['/login','/register','/resources/main.css'];
const userPages = ['/messages'];
hbs.registerPartials(`${__dirname}/views/partials`);
app.set('viewEngine','hbs');

app.use(cookieParser());
app.use((req,res,next)=>{
	//next();
	//return;
	if(guestPages.includes(req._parsedUrl.path)){
		next();
		return;
	}
	if(req.cookies.sessionID){
		db.validSession(req.cookies.username,req.cookies.sessionID,(valid)=>{
			if(valid) {
				next();
				return;
			} else {
				res.redirect('/login');
			}
		});
	} else {
		res.redirect('/login');
	}
});
/*
app.use((req,res,next)=>{
	if(req._parsedUrl.path.indexOf('/messHages') > -1){
		let user = req._parsedUrl.path.substring(10,10+req.cookies.username.length);
		db.validSession(user,req.cookies.sessionID,(valid)=>{
			if(!valid) return;
			next();
		});
	//	console.log(req._parsedUrl.path.substring(10,10+req.cookies.username.length-1));
	} else {
		next();
	}
});*/
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));
app.use((req,res,next)=>{
	let now = new Date().toString();
	let log = `${now} ${req.url} ${req.method} by ${req.headers['x-forwarded-for'] || req.connection.remoteAddress}`;
	fs.appendFile('server.log',log + '\n', (err)=>{
		if(err){
			console.log('Unable to append to file!');
		}
	});
	next();
});
app.use(express.static(`${__dirname}/public`));
app.listen(port,()=>{
	  console.log(`Listening on port ${port}`);
});

app.get('/',(req,res)=>{
	db.getMessages(req.cookies.username,(messages)=>{
		messages.forEach(msg=>{
			msg.user = msg.user1 !== req.cookies.username?msg.user1:msg.user2;
		});
		res.render('index.hbs',{
			messages
		});
	});
});
app.post('/send_message',(req,res)=>{
	if(!req.body.message.message || !req.body.message.recipient){
		res.render('messagesent.hbs',{
			error:'Invalid request!'
		});
		return;
	}
	db.addMessage(req.body.message.message,req.cookies.username,req.body.message.recipient,(response,err)=>{
		if(err){
			console.log(err);
			res.render('messagesent.hbs',{
				error:err
			});
		} else {
			res.redirect(`/messages/${response}`);
		}
	});
});

app.get('/messages/*',(req,res)=>{
	thread = req.url.split('/');
	thread = thread[thread.length-1];
	if(!thread) {
		res.render('messagesent.hbs',{
			error:'Invalid request!'
		});
		return;
	}
	db.getMessageThread(thread,req.cookies.username,(response)=>{
		if(response.error){
			res.render('messagesent.hbs',{
				error:response.error
			});
			return;
		}
		messages = response.response;
		otherUser = messages.user1 !== req.cookies.username?messages.user1:messages.user2;
		res.render('messageview.hbs',{
			otherUser,
			messages:messages.messages
		});
		
	});
});

app.get('/change_password',(req,res)=>{
	res.render('changepassword.hbs',{
		display:"none",
	});
});
app.post('/change_password',(req,res)=>{
	if(!req.body.pass1 || !req.body.pass2 || req.body.pass1 !== req.body.pass2){
		res.render('changepassword.hbs',{
			display:"block",
			error:"New passwords don't match!",
			password:req.body.password,
		});
		return;
	}
	db.passMatch(req.cookies.username,sha256(req.body.password),(match,user)=>{
		//hey so add a thing in the db file that does this 
		if(!match){
			res.render('changepassword.hbs',{
				display:"block",
				error:"Current password wrong!",
				pass1:req.body.pass1,
				pass2:req.body.pass2
			});
			return;
		}
		user.password = sha256(req.body.pass1);
		db.changePass(user,()=>{
			res.render('changepassword.hbs',{
				display:"block",
				error:"Password updated!",
			});
			return;

		});
		//now add the new password
		console.log(match);
	});
});
app.get('/login',(req,res)=>{
	res.render('login.hbs',{
		display:"none",
	});

});

app.post('/login',(req,res)=>{
	if(req.body.username && req.body.password){
		db.login(req.body.username, sha256(req.body.password),(result)=>{
			if(!result.success){
				res.render('login.hbs',{
					display:"block",
					error:"Invalid username or password!"
				});
			} else {
				res.cookie('username',req.body.username,{ maxAge: Number.MAX_SAFE_INTEGER });
				res.cookie('sessionID',result.sessionID,{ maxAge: Number.MAX_SAFE_INTEGER });
				res.redirect('/');
			}
		});
	} else {
		res.render('login.hbs',{
			display:"block",
			error:"Enter a username and password!"
		});
	}
});
app.get('/register',(req,res)=>{
	res.render('register.hbs',{
		display:"none",
	});
});
app.post('/register',(req,res)=>{
	if(settings.registerLock){
		res.render('register.hbs',{
			display:"block",
			error:"Registration disabled!"
		});
		return;
	}
	if(!req.body.pass1 || !req.body.pass2 || req.body.pass1 !== req.body.pass2){
		res.render('register.hbs',{
			display:"block",
			error:"Passwords don't match!",
			username:req.body.username,
			email:req.body.email
		});
		return;
	}
	if(!req.body.email || !regex.email.test(req.body.email)){
		res.render('register.hbs',{
			display:"block",
			error:"Invalid Email!",
			pass1:req.body.pass1,
			pass2:req.body.pass2,
			username:req.body.username
		});
		return;
	}
	if(!req.body.username || regex.xss.test(req.body.username)){
		res.render('register.hbs',{
			display:"block",
			error:"Invalid Username!",
			pass1:req.body.pass1,
			pass2:req.body.pass2,
			email:req.body.email
		});
		return;
	}
	db.userExists(req.body.username,(exists)=>{
		if(exists) {
			res.render('register.hbs',{
				display:"block",
				error:"Username Taken!",
				pass1:req.body.pass1,
				pass2:req.body.pass2,
				email:req.body.email
			});
			return;
		}
		let sessionID = sha256(String(Math.random()*Math.random()));
		db.addUser({
			username:req.body.username,
			password:sha256(req.body.pass1),
			email: req.body.email,
			sessions:[sessionID],
			sessionTimes:[Date.now() + settings.tokenTimeout]
		});

		res.cookie('username',req.body.username,{ maxAge: Number.MAX_SAFE_INTEGER });
		res.cookie('sessionID',sessionID,{ maxAge: Number.MAX_SAFE_INTEGER });
		res.redirect('/');
	});
});
