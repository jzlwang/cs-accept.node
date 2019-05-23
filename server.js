// core-services acceptance
// A Web app which will allow writing data to p-mysql and/or p-riakcs
//   - test that the services have been installed and configured correctly
//   - a visual way to validate that data is durable across upgrades, etc.
//
// NOTE: To run in local mode, provide a VCAP_SERVICES env variable like this:
// VCAP_SERVICES={"p-mysql":[{"credentials":{"uri":"mysql://user:password@127.0.0.1/latticeDB"}}]}

var finalhandler = require('finalhandler') ;
var http = require('http') ;
var serveStatic = require('serve-static') ;
var strftime = require('strftime') ;
var time = require('time') ;
var url = require('url') ;
var util = require('util') ;
var mysql = require('mysql') ;
var fs = require('fs') ;
var bindMySQL = require('./bind-mysql.js') ;

// Variables
var data = "" ;
var activateState = Boolean(false) ;
mysql_data_service = undefined ;
var mysql_creds = {} ;
var vcap_services = undefined ;
var dbClient = undefined ;
var dbConnectState = Boolean(false) ;
var dbConnectTimer = undefined ;
var riakcs_credentials = undefined ;
var riakcsClient = undefined ;
var riakcsConnectionState = Boolean(false) ;

// Setup based on Environment Variables
mysql_creds = bindMySQL.getMySQLCreds() ;
if (mysql_creds) { activateState="mysql" ; }

if (process.env.VCAP_APP_PORT) { var port = process.env.VCAP_APP_PORT ;}
else { var port = 8080 ; }
if (process.env.CF_INSTANCE_INDEX) { var myIndex = JSON.parse(process.env.CF_INSTANCE_INDEX) ; }
else { myIndex = 0 ; }
var myInstance = "Instance_" + myIndex + "_Hash" ;

function setupSchema() {
    dbClient.query("show tables LIKE 'SampleData'", function(err, results, fields) {
        if (err) {
            console.error(err) ;
            process.exit(1) ;
        } else {
            if (0 == results.length) {
                util.log("Setting up schema.") ;
                dbClient.query("create table SampleData (K VARCHAR(20) PRIMARY KEY, V VARCHAR(20))",
                               function (err, results, fields) {})
            } else {
                util.log("SampleData table already exists.") ;
            }
        }
    }) ;
}

// Callback functions

function handleDBerror(err) {
    if (err) {
        console.warn("Issue with database, " + err.code + ". Attempting to reconnect every 1 second.")
        setTimeout(MySQLConnect, 1000) ;
    }
}

function handleDBConnect(err) {
    if (err) {
        dbConnectState = false ;
        console.error("ERROR: problem connecting to DB: " + err.code +
                      ", will try again every 1 second.") ;
        dbConnectTimer = setTimeout(MySQLConnect, 1000) ;
    } else {
        util.log("Connected to database.") ;
        dbClient.on('error', handleDBerror) ;
        dbConnectState = true ;
        if (dbConnectTimer) {
            clearTimeout(dbConnectTimer) ;
            dbConnectTimer = undefined ;
        }
        setupSchema() ;
    }
}

function handleDBping(request, response, err) {
    if (err) {
        util.log("MySQL Connection error: " + err) ;
        response.end("MySQL connection error: " + err) ;
        dbClient.destroy() ;
        MySQLConnect() ;
    } else {
        response.end("MySQL ping successful.") ;
    }
}

function handleRiakcsConnect(message, err) {
    util.log("handleRiakcsConnect called with message: " + message) ;
    switch (message) {
    case "error":
        riakcsConnectionState = false ;
        util.log("Riakcs connection failed: " + err + "\nWill try again in 3s." ) ;
        setTimeout(RiakcsConnect, 3000) ;
        break ;
    case "ready":
        riakcsConnectionState = true ;
        riakcsClient.hget(myInstance, "lastKeyUpdated", handleLastKey) ;
        riakcsClient.hget(myInstance, "lastUpdate", handleLastTime) ;
        util.log("Riakcs READY.") ;
        break ;
    }
}



// Helper functions

function doPing(request, response) {
    dbClient.ping(function (err) {
        handleDBping(request, response, err) ;
    }) ;
}

function doStatus(request, response) {
    dbClient.query("SHOW STATUS LIKE 'Ssl_version'", function (err, results, fields) {
        response.end(JSON.stringify({"dbStatus": dbConnectState,
                                     "tls-cipher": results[0]["Value"]})) ;
    }) ;
}

function doReplicationStatus(request, response) {
  dbClient.query("SHOW SLAVE STATUS", function (err, results, fields) {
    console.log("The results are: " + results) ;
    if (results === undefined || results.length == 0) {
      console.log("HEYO! I'm a leader!") ;
      dbClient.query("SHOW SLAVE HOSTS", function (err, results, fields) {
        console.log("Leader slaves: " + results) ;
        response.end(JSON.stringify({"Server_id": results[0][Server_id],
                                      "Host": results[0][Host],
                                      "Port": results[0][Port],
                                      "Master_id": results[0][Master_id],
                                      "Slave_UUID": results[0][Slave_UUID]})) ;
      }) ;
    } else {
      response.end(JSON.stringify({"Slave_IO_State": results[0]["Slave_IO_State"],
                                    "Master_Host": results[0]["Master_Host"],
                                    "Master_Port": results[0]["Master_Port"],
                                    "Slave_IO_Running": results[0]["Slave_IO_Running"],
                                    "Slave_SQL_Running": results[0]["Slave_SQL_Running"],
                                    "Master_UUID": results[0]["Master_UUID"]})) ;
    }
  }) ;
}

function MySQLConnect() {
    if (activateState) {
        clientConfig = {
            host : mysql_creds["host"],
            user : mysql_creds["user"],
            password : mysql_creds["password"],
            port : mysql_creds["port"],
            database : mysql_creds["database"]
        } ;
        if (mysql_creds["ca_certificate"]) {
            console.log("CA Cert detected; using TLS");
            clientConfig["ssl"] = { ca : mysql_creds["ca_certificate"] } ;
        }
        dbClient = mysql.createConnection( clientConfig ) ;
        dbClient.connect(handleDBConnect) ;
    } else {
        dbClient = undefined ;
    }
}

function sql2json(request, response, error, results, fields) {
    if (error) {
        dbError(response, error) ;
    } else {
        var dataSet = [] ;
        for (var kv in results) {
            dataSet.push( [ results[kv]['K'], results[kv]['V'] ] ) ;
        }
        response.end(JSON.stringify(dataSet)) ;
    }
}

function handleWriteRequest(request, response, error, results, fields) {
    if (error) { dbError(response, error) }
    else {
        response.writeHead(302, {'Location': '/'}) ;
        response.end()
    }
    return(true) ;
}

function dbError(response, error) {
    console.error("ERROR getting values: " + error) ;
    response.end("ERROR getting values: " + error) ;
}

function errorDbNotReady(response) {
    errHTML = "<title>Error</title><H1>Error</H1>\n"
    errHTML += "<p>Database info is not set or DB is not ready<br>\n" ;
    errHTML += "<hr><A HREF=\"/dbstatus\">/dbstatus</A>\n" ;
    response.end(errHTML) ;
}

function readTable(request, response, table, callBack) {
    if ("mysql" == activateState && dbConnectState) {
        dbClient.query('SELECT K, V from ' + table,
                       function (error, results, fields) {
                           callBack(request, response, error, results, fields) ;
                       }) ;
    } else {
        errorDbNotReady(request, response) ;
    }
}

function writeSomething(request, response, key) {
    if ("mysql" == activateState && dbConnectState) {
        var timeStamp = strftime("%Y-%m-%d %H:%M") ;
        var sql = "insert into SampleData VALUES ('" + key + "','" + timeStamp + "')" ;
        console.log("SQL: " + sql ) ;
        dbClient.query(sql, function (error, results, fields) {
            handleWriteRequest(request, response, error, results, fields) ;
        }) ;
    } else {
        errorDbNotReady(response) ;
    }
}

function dispatchApi(request, response, method, query) {
    switch (method) {
    case "dbstatus":
        if (dbConnectState) {
            doStatus(request, response) ;
        } else {
            data += "I'm sorry, Dave, I can't do that. No connection to database." ;
            response.end(data) ;
        }
        break ;
    case "replication-status":
      if (dbConnectState) {
        doReplicationStatus(request, response) ;
      } else {
        data += "I'm sorry, Dave, I can't do that. No connection to database." ;
        response.end(data) ;
      }
      break ;
    case "read":
        if (query["table"]) {
            util.log("Received request to read table: " + query["table"]) ;
            readTable(request, response, query["table"], sql2json) ;
        } else {
            response.end("ERROR: Usage: /json/read?table=name"
                         + " (request: " + request.url + ")") ;
        }
        break ;
    default:
        response.writeHead(404) ;
        response.end(false) ;
    }

}

function requestHandler(request, response) {
    var data = "" ;
    requestParts = url.parse(request.url, true) ;
    rootCall = requestParts["pathname"].split('/')[1] ;
    util.log("Recieved request for: " + rootCall) ;
    switch (rootCall) {
    case "env":
	      if (process.env) {
	          data += "<p>" ;
		        for (v in process.env) {
		            data += v + "=" + process.env[v] + "<br>\n" ;
		        }
		        data += "<br>\n" ;
	      } else {
		        data += "<p> No process env? <br>\n" ;
	      }
        response.end(data) ;
        break ;
    case "json":
        var method = requestParts["pathname"].split('/')[2] ;
        dispatchApi(request, response, method, requestParts["query"]) ;
        return(true) ;
        break ;
    case "dbstatus":
        if (dbConnectState) {
            doStatus(request, response) ;
        } else {
            data += "I'm sorry, Dave, I can't do that. No connection to database." ;
            response.end(data) ;
        }
        break ;
    case "replication-status":
        if (dbConnectState) {
            doReplicationStatus(request, response) ;
        } else {
            data += "I'm sorry, Dave, I can't do that. No connection to database." ;
            response.end(data) ;
        }
      break ;
    case "ping":
        if (dbConnectState) {
            doPing(request, response) ;
        } else {
            data += "I'm sorry, Dave, I can't do that. No connection to database." ;
            response.end(data) ;
        }
        break ;
    case "write":
        if (requestParts["query"]["key"]) {
            util.log("Received request to write key: " + requestParts["query"]["key"]) ;
            writeSomething(request, response, requestParts["query"]["key"]) ;
        } else {
            response.end("ERROR: Usage: /write?key=foo"
                         + "(request: " + request.url  + ")") ;
        }
        return(true) ;
        break ;
    default:
        response.writeHead(404) ;
        response.end("404 - not found") ;
    }
}

// MAIN

if ("mysql" == activateState) {
    MySQLConnect() ;
} else if ("riakcs" != activateState) {
    console.error("Error: Not set up to use either MySQL or RiakCS as a backing store.") ;
}

var staticServer = serveStatic("static") ;
monitorServer = http.createServer(function(req, res) {
    var done = finalhandler(req, res) ;
    staticServer(req, res, function() {requestHandler(req, res, done)}) ;
}) ;

monitorServer.listen(port) ;

util.log("Server up and listening on port: " + port) ;
