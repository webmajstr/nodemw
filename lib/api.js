/**
 * Helper "class" for accessing MediaWiki API and handling cookie-based session
 */
(function(exports) {

	// import deferred-js
	// @see https://github.com/heavylifters/deferred-js
	var Deferred = require('./deferred/deferred').Deferred;

	// wait x ms between HTTP requests
	var QUEUE_DELAY = 500;

	var api = function(options) {
		this.server = options.server;
		this.path = options.path;
		this.proxy = options.proxy;
		this.debug = options.debug;

		this.cookieJar = '';

		// requests queue
		this.queue = [];
		this.queueItemId = 0;

		this.http = require('http');
		this.formatUrl = require('url').format;

		this.userAgent = 'nodemw (node.js ' + process.version + ')';
	}

	var doRequest = function(params, callback, method) {
		var self = this,
			promise = new Deferred();

		params = params || {};
		method = method || 'GET';

		// force JSON format
		params.format = 'json';

		// add additional headers
		var headers = {
			'User-Agent': this.userAgent,
			'Content-Length': 0
		};

		if (this.cookieJar) {
			headers['Cookie'] = this.cookieJar;
		}

		// handle POST methods
		if (method === 'POST') {
			var postParams = this.formatUrl({query: params}).substring(1);

			headers['Content-Type'] = 'application/x-www-form-urlencoded';
			headers['Content-Length'] = postParams.length;

			params = {
				action: params.action
			};
		}

		// @see http://nodejs.org/api/url.html
		var url = this.formatUrl({
			protocol: 'http',
			hostname: this.server,
			pathname: this.path + '/api.php',
			query: params
		});

		this.log('URL [' + method + ']: ' + url);

		// form the request
		var req = this.http.request({
			host: this.proxy || this.server,
			method: method,
			headers: headers,
			path: url
		}, function(res) {
			res.body = '';

			// request was sent, now wait for the response
			res.on('data', function(chunk) {
				res.body += chunk;
			});

			res.on('end', function() {
				self.log(res.body);

				// store cookies
				var cookies = res.headers['set-cookie'];
				if (cookies) {
					cookies.forEach(function(cookie) {
						cookie = cookie.split(';').shift();
						self.cookieJar += (cookie + ';');
					});
				}

				// parse response
				var data,
					info,
					next;

				try {
					data = JSON.parse(res.body);
					info = data && data[params.action];
					next = data && data['query-continue'] && data['query-continue'][params.list];
				}
				catch(e) {
					throw 'Error parsing JSON response: ' + res.body;
				}

				if (info) {
					callback(info, next);
					promise.resolve({info: info, next: next});
				}
				else if (data.error) {
					throw 'Error returned by API: ' + data.error.info;
				}
			});
		});

		req.on('error', function(e) {
			self.log(e.stack);
		});

		// finish sending a request
		if (method === 'POST') {
			this.log(postParams);
			req.write(postParams);
		}

		req.end();

		return promise;
	};

	// queue handling
	var addToQueue = function(item) {
		var promise = new Deferred();

		// add to the queue
		this.queue.push({
			id: this.queueItemId++,
			args: item,
			promise: promise
		});

		processQueue.apply(this);

		return promise;
	};

	var processQueue = function() {
		var self = this,
			item;

		// is queue running? this function will be called via setTimeout
		if (this.queueBusy === true) {
			return;
		}

		// get an item to process
		item = this.queue.shift();

		// the queue is empty
		if (typeof item === 'undefined') {
			return;
		}

		this.queueBusy = true;

		doRequest.apply(this, item.args).then(function() {
			item.promise.resolve(arguments);

			// schedule next queue check
			setTimeout(function() {
				self.queueBusy = false;
				processQueue.call(self);
			}, QUEUE_DELAY);
		});
	};

	// public interface
	api.prototype = {
		log: function(obj) {
			if (this.debug) {
				console.log(obj);
			}
		},

		// adds request to the queue and returns a promise
		call: function(params, callback, method) {
			return addToQueue.call(this, arguments);
		}
	};

	exports.api = api;

})(exports);
