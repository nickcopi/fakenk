const mongo = require('mongodb');
const sha256 = require('js-sha256');
const settings = require('./settings');
let MongoClient = require('mongodb').MongoClient;
let url = "mongodb://localhost:27017/c2";
const c2 = 'c2';
let ObjectId = require('mongodb').ObjectId;

module.exports.init = ()=>{
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		//dbo.collection('users').deleteMany({},(err,res)=>{});
		dbo.createCollection('users', function(err, res) {
			if (err) throw err;
				console.log("Collection created!");
		});
		dbo.collection('users').find({}).toArray((err,res)=>{
			console.log(res);
		});
		//dbo.collection('messages').deleteMany({},(err,res)=>{});
		dbo.createCollection('messages', function(err, res) {
			if (err) throw err;
				console.log("Collection created!");
		});
		dbo.collection('messages').find({}).toArray((err,res)=>{
			console.log(res);
			db.close();
		});
	});
};

module.exports.passMatch = (username,password,callback)=>{
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		dbo.collection('users').find({username}).toArray((err,res)=>{
			db.close();
			if(!res[0]) {
				callback(false);
				return;
			}
			callback(res[0].password === password,res[0]);
			return;
		});	
	});
};

module.exports.changePass = (user,callback)=>{//figure out how to use this 
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		dbo.collection('users').update({username:user.username},user,(err,res)=>{
			db.close();
			callback();
			return;
		});
	});
};

module.exports.getMessageThread = (thread,username,callback) => {
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		let id;
		try{
			id = ObjectId(thread);
		}
		catch(e){
			if(e){
				callback({error:'Invalid message thread.'});
				return;
			}
		}
		dbo.collection('messages').find({_id:id}).toArray((err,res)=>{
			db.close();
			if(res.length < 1){
				callback({error:'No messages found.'});
				return;
			}
			if(res[0].user1 === username || res[0].user2 === username){
				callback({response:res[0]});
			} else {
				callback({error:'Unauthorized to view messages.'});
				// could give a flag for this
			}
		});
	});
};

module.exports.getMessages = (user,callback) => {
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		let messages = [];
		dbo.collection('messages').find({user1:user}).toArray((err,res)=>{
			messages = messages.concat(res);
			dbo.collection('messages').find({user2:user}).toArray((err,res)=>{
				messages = messages.concat(res);
				callback(messages);
				db.close();
			});
		});
	});
};
module.exports.addMessage = (message,sender,receiver,callback) => {
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		let messages;
		dbo.collection('messages').find({user1:sender,user2:receiver}).toArray((err,res)=>{
			messages = res;
			dbo.collection('messages').find({user1:receiver,user2:sender}).toArray((err,res)=>{
				if(res.length) messages = res;
				if(messages.length < 1){
					addMessageChain(message,sender,receiver,(response)=>{
						if(response.error) callback(null,response.error);
						else callback(response.id);
						db.close();
					});
				} else {
					dbo.collection('messages').find({_id: messages[0]._id}).toArray((err,res)=>{
						if(res.length < 1){
							callback('Message chain found but not found?')
							return;
						} 
						foundMessages = res[0].messages;
						foundMessages.push({
							username:sender,
							message
						});
						res[0].messages = foundMessages;
						dbo.collection('messages').update({_id: messages[0]._id},res[0],(err,res)=>{
							if(err) callback(null,err);
							else callback(messages[0]._id);

						});
						db.close();
					});
				}
			});
		});
	});

};


let addMessageChain = (message,user,recip,callback)=>{
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		dbo.collection('users').find({username:recip}).toArray((err,res)=>{
			if(!res[0]) {
				callback({error:'Recipient not found!'});
				return;
			}
			dbo.collection("messages").insertOne({
				user1:user,
				user2:recip,
				messages:[{
					username: user,
					message:message
				}]
			}, function(err, res) {
				if (err) throw err;
				db.close();
				callback({id:res.insertedId});
			});
			return;
		});	
	});

};
let addSession = (user,callback)=>{
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		dbo.collection('users').update({username:user.username},user,(err,res)=>{
			db.close();
			callback();
			return;
		});
	});

};

module.exports.login = (username,password,callback)=>{
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		dbo.collection('users').find({username}).toArray((err,res)=>{
			if(res.length < 1){
				db.close();
				callback({success:false});
				return
			}
			if(res[0].password == password){
				db.close();
				let sessionID = sha256(String(Math.random()*Math.random()));
				res[0].sessions.push(sessionID);
				res[0].sessionTimes.push(Date.now() + settings.tokenTimeout);
				addSession(res[0],()=>{
					callback({
						success: true,
						sessionID 
					});
					return;
				});
			} else {
				db.close();
				callback(false);
				return;
			}
		});
	});
};

module.exports.userExists = (username,callback)=>{
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		dbo.collection('users').find({username}).toArray((err,res)=>{
			db.close();
			callback(res.length !== 0);
			return;
		});	
	});
};

module.exports.validSession = (username,sessionID,callback)=>{
	MongoClient.connect(url, function(err, db) {
 		let dbo = db.db(c2);
		dbo.collection('users').find({username}).toArray((err,res)=>{
			db.close();
			if(res.length < 1){
				callback(false);
				return;
			}
			//console.log(`wow ${JSON.stringify(res)} ok so heres ${res.sessions}`);
			let sessionIndex = res[0].sessions.indexOf(sessionID)
			if(sessionIndex === -1){
				callback(false);
				return;
			}
			if(res[0].sessionTimes[sessionIndex] < Date.now()){
				res[0].sessions.splice(sessionIndex,1);
				res[0].sessionTimes.splice(sessionIndex,1);
				addSession(res[0], ()=>{
					callback(false);
					return;
				});
			} else {
				callback(res[0].sessions.includes(sessionID));
				return;
			}
		});	
	})

};
module.exports.addUser = (user)=> {MongoClient.connect(url, function(err, db) {
	if (err) throw err;
 	let dbo = db.db(c2);
	dbo.collection("users").insertOne(user, function(err, res) {
		if (err) throw err;
		db.close();
	});
	/*dbo.collection('users').find({username:'aaa'}).toArray((err,res)=>{
		console.log(res);
		db.close();
	});*/
	
})};
