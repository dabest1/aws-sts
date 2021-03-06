'use strict';

const Nightmare = require('nightmare');
const clui = require('clui');
const coinquirer = require('coinquirer');
const pkg = require('../../package.json');
const path = require('path');
const MfaProviders = require('./okta-mfa');
const sleep = require('sleep');


const Okta = {
  name: 'Okta',

  login: function *(idpEntryUrl, username, password) {
    let spinner = new clui.Spinner('Logging in...');

    let ci = new coinquirer();
    username = username ? username : yield ci.prompt({
      type: 'input',
      message: 'Okta username (ex. user@domain.com):'
    });
    password = password ? password : yield ci.prompt({
      type: 'password',
      message: 'Okta password:'
    });

    spinner.start();

    let nightmare = Nightmare({show: process.env.DEBUG});
    let hasError = yield nightmare
      .useragent(pkg.description + ' v.' + pkg.version)
      .goto(idpEntryUrl)
      .wait('#okta-sign-in')
      .insert('input[name="username"]', username)
      .insert('input[name="password"]', password)
      .click('input[value="Sign In"]')
      .wait('.okta-form-infobox-error, #okta-sign-in .mfa-verify')
      .exists('.okta-form-infobox-error');
    spinner.stop();

    if (hasError) {
      let errMsg = yield nightmare.evaluate(function () {
        return document.querySelector('.o-form-content .o-form-error-container').innerText;
      });
      yield fail(nightmare, errMsg);
    }

    for (let i = 0; i < MfaProviders.length; i++) {
      const mfaProvider = MfaProviders[i];
      const good = yield mfaProvider.detect(nightmare);
      if (good) {
        try {
          const prompt = yield mfaProvider.prompt(ci);
          yield mfaProvider.verify(prompt, nightmare);
        } catch (err) {
          yield fail(nightmare, err.message);
        }
        break;
      }
    }

    function *getSamlResponse(nightmare) {
      for(var i = 0; i < 120; i++) {
        try {
          let result = yield nightmare
            .evaluate(function () {
              return document.querySelector('input[name="SAMLResponse"]').value;
            });
          return result;
        } catch (e) {
        }
        sleep.msleep(250);
      }
    }

    let samlAssertion = yield getSamlResponse(nightmare);
    yield nightmare.end();
    spinner.stop();

    return samlAssertion;
  }
};

function *fail(nightmare, errMsg) {
  if (process.env.DEBUG) {
    yield nightmare
      .screenshot(path.join(process.cwd(), '.debug', 'error.png'))
      .html(path.join(process.cwd(), '.debug', 'error.html'), 'HTMLComplete');
  }

  throw new Error(errMsg);
}

module.exports = Okta;
