module.exports.getMySQLCreds = function(service) {

    var mysql_creds = {} ;
    var service = undefined ;
    if (process.env.VCAP_SERVICES && Object.keys(process.env.VCAP_SERVICES).length) {
        var vcap_services = JSON.parse(process.env.VCAP_SERVICES) ;
        if (vcap_services['p.mysql']) {
            service = "p.mysql" ;
        } else if (vcap_services['p-mysql']) {
            service = "p-mysql" ;
        } else if (vcap_services['user-provided']) {
            service = "user-provided" ;
        } else if (vcap_services['pxc']) {
            service = "pxc" ;
        }
        if (service) {
            console.log("Discovering credentials for: " + service) ;
            mysql_creds["host"] = vcap_services[service][0]["credentials"]["hostname"] ;
            mysql_creds["user"] = vcap_services[service][0]["credentials"]["username"] ;
            mysql_creds["password"] = vcap_services[service][0]["credentials"]["password"] ;
            mysql_creds["port"] = vcap_services[service][0]["credentials"]["port"] ;
            mysql_creds["database"] = vcap_services[service][0]["credentials"]["name"] ;
            if (vcap_services[service][0]["credentials"]["tls"]) {
                mysql_creds["ca_certificate"] = vcap_services[service][0]["credentials"]["tls"]["cert"]["ca"];
            } else {
                mysql_creds["ca_certificate"] = undefined ;
            }
            mysql_creds["uri"] = vcap_services[service][0]["credentials"]["uri"] ;
        }
    } else {
        console.log("No VCAP_SERVICES in environment; using localhost") ;
        service = "local" ;
        mysql_creds["host"] = "localhost" ;
        mysql_creds["user"] = "root" ;
        mysql_creds["password"] = "password" ;
        mysql_creds["database"] = "service_instance_db" ;
        mysql_creds["ca_certificate"] = undefined ;
        return(mysql_creds) ;
    }

    console.log("Got access credentials to: " + service) ;
    return(mysql_creds) ;
}
