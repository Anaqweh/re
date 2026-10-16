#!/usr/bin/env python3
"""Activate course Checkout on the existing INEXC server. Never print credentials."""
import datetime
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = 'https://api.inexctraining.com/api/payments/stripe/webhook'
EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
          'checkout.session.async_payment_failed', 'checkout.session.expired']
KEYS = ('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_CHECKOUT_ENABLED')
MARKER = 'inexc-stripe-checkout-v1'


def abort(message):
    raise RuntimeError(message)


def stripe_request(secret, route, params=None):
    headers = {'Authorization': 'Bearer ' + secret, 'Stripe-Version': '2026-08-26.dahlia'}
    data = None
    if params is not None:
        data = urllib.parse.urlencode(params).encode()
        headers.update({'Content-Type': 'application/x-www-form-urlencoded',
                        'Idempotency-Key': 'inexc-course-webhook-v1'})
    try:
        with urllib.request.urlopen(urllib.request.Request(
                'https://api.stripe.com/v1/' + route, data=data, headers=headers), timeout=25) as response:
            return json.load(response)
    except (urllib.error.URLError, ValueError):
        abort('Stripe request failed. Check the live key and its account/webhook permissions. No provider response or secret was printed.')


def existing_value(contents, name):
    values = re.findall(r'^\s*' + re.escape(name) + r'\s*=\s*([^\r\n]*)$', contents, re.M)
    return values[-1].strip().strip("'\"") if values else ''


def update_env(contents, values):
    # Keep all unrelated settings byte-for-byte; replace only literal Stripe assignments.
    retained = ''.join(line for line in contents.splitlines(keepends=True)
                       if not re.match(r'^\s*(?:' + '|'.join(KEYS) + r')\s*=', line))
    return retained.rstrip('\r\n') + '\n' + ''.join(name + '=' + values[name] + '\n' for name in KEYS)


def atomic_write(path, contents):
    fd, temporary = tempfile.mkstemp(prefix='.inexc-stripe-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(contents)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def compose_override(directory):
    bases = [directory / name for name in ('compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml')
             if (directory / name).is_file()]
    if len(bases) != 1 or os.environ.get('COMPOSE_FILE') or os.environ.get('COMPOSE_ENV_FILES'):
        abort('Use one conventional Compose file in INEXC_API_DIR. Custom Compose selections require a manual server setup.')
    candidates = [directory / name for name in ('compose.override.yaml', 'compose.override.yml',
                                               'docker-compose.override.yaml', 'docker-compose.override.yml')
                  if (directory / name).exists()]
    if len(candidates) > 1:
        abort('Multiple Compose overrides exist; no configuration was changed.')
    path = candidates[0] if candidates else directory / ('compose.override.yaml' if bases[0].name.startswith('compose.') else 'docker-compose.override.yml')
    if path.exists():
        try:
            owned = json.loads(path.read_text()).get('x-inexc-managed') == MARKER
        except (ValueError, AttributeError):
            owned = False
        if not owned:
            abort('An existing Compose override is in use. Add the three Stripe environment variables to its api service manually; this script will not overwrite it.')
    return path


def webhook_secret(secret, previous):
    matching, cursor = [], None
    while True:
        result = stripe_request(secret, 'webhook_endpoints?limit=100' +
                                ('&starting_after=' + urllib.parse.quote(cursor) if cursor else ''))
        endpoints = result.get('data', [])
        matching.extend(item for item in endpoints if item.get('url') == ENDPOINT)
        if not result.get('has_more'):
            break
        if not endpoints:
            abort('Unable to inspect existing webhooks safely.')
        cursor = endpoints[-1]['id']
    if len(matching) > 1:
        abort('Multiple matching Stripe webhooks exist. Keep one endpoint for this URL before activation.')
    if matching:
        item = matching[0]
        enabled = set(item.get('enabled_events', []))
        if item.get('status') != 'enabled' or not ('*' in enabled or set(EVENTS) <= enabled):
            abort('The existing webhook is disabled or missing Checkout events. Enable the four events listed in docs/stripe-checkout.md.')
        value = previous or getpass.getpass('Existing endpoint signing secret (whsec_, hidden): ').strip()
    else:
        params = {'url': ENDPOINT, 'api_version': '2026-08-26.dahlia',
                  'description': 'INEXC course registration payment confirmation'}
        params.update({'enabled_events[' + str(i) + ']': event for i, event in enumerate(EVENTS)})
        value = stripe_request(secret, 'webhook_endpoints', params).get('secret', '')
    if not re.fullmatch(r'whsec_[A-Za-z0-9_]+', value):
        abort('A valid webhook signing secret is required.')
    return value


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r'[a-f0-9]{40}', sys.argv[1]):
        abort('Usage: python3 deploy-stripe-checkout.py FULL_COMMIT_SHA')
    if not sys.stdin.isatty():
        abort('Run from an interactive server terminal; credentials must be entered with hidden input.')
    os.umask(0o077)
    directory = Path(os.environ.get('INEXC_API_DIR', '/opt/inexc-training/inexc-api')).resolve()
    override = compose_override(directory)
    env_file = directory / '.env'
    if env_file.is_symlink() or override.is_symlink():
        abort('Credential configuration paths must be regular files, not symbolic links.')
    original = env_file.read_text() if env_file.exists() else ''
    child_env = {name: value for name, value in os.environ.items() if name not in KEYS}
    child_env['INEXC_API_DIR'] = str(directory)
    child_env['INEXC_REQUIRE_STRIPE'] = '1'
    preflight = subprocess.run(['docker', 'compose', 'config', '--format', 'json'],
                               cwd=directory, env=child_env, capture_output=True, text=True)
    try:
        valid = preflight.returncode == 0 and 'api' in json.loads(preflight.stdout)['services']
    except (ValueError, KeyError):
        valid = False
    if not valid:
        abort('Existing Docker Compose api service could not be validated. No configuration changed.')
    release = sys.argv[1]
    with tempfile.TemporaryDirectory(prefix='inexc-stripe-release-') as temporary:
        deploy = Path(temporary) / 'deploy-learner-workspace.sh'
        try:
            with urllib.request.urlopen('https://raw.githubusercontent.com/Anaqweh/re/' + release +
                                        '/scripts/deploy-learner-workspace.sh', timeout=30) as response:
                deploy.write_bytes(response.read())
        except urllib.error.URLError:
            abort('Unable to download the pinned deployment script; nothing changed.')
        previous = existing_value(original, 'STRIPE_SECRET_KEY')
        print('Enter the live Stripe secret key in this server terminal only. Input is hidden.')
        secret = getpass.getpass('Live API key' + (' (Enter keeps existing)' if previous else '') + ': ').strip() or previous
        if not re.fullmatch(r'(sk|rk)_live_[A-Za-z0-9_]+', secret):
            abort('A live key is required; test keys cannot enable public payment.')
        account = stripe_request(secret, 'account')
        if account.get('charges_enabled') is not True:
            abort('Stripe has not enabled charges for this account. Complete account activation in the Stripe dashboard.')
        print('Live Stripe account verified: ' + str(account.get('id', '')))
        signing = webhook_secret(secret, existing_value(original, 'STRIPE_WEBHOOK_SECRET') if previous == secret else '')
        backup = directory / ('stripe-activation-backup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        backup.mkdir(mode=0o700)
        for path in (env_file, override):
            if path.exists():
                shutil.copy2(path, backup / path.name)
                os.chmod(backup / path.name, 0o600)
        try:
            atomic_write(env_file, update_env(original, dict(zip(KEYS, (secret, signing, '1')))))
            atomic_write(override, json.dumps({'x-inexc-managed': MARKER, 'services': {'api': {'environment': {
                name: '${' + name + ':-' + ('0' if name.endswith('ENABLED') else '') + '}' for name in KEYS}}}}, indent=2) + '\n')
            # Capture resolved configuration privately: Compose output may contain other server secrets.
            check = subprocess.run(['docker', 'compose', 'config', '--format', 'json'], cwd=directory,
                                   env=child_env, capture_output=True, text=True)
            if check.returncode != 0:
                abort('Compose configuration check failed.')
            configured = json.loads(check.stdout)['services']['api']['environment']
            if any(configured.get(name) != value for name, value in zip(KEYS, (secret, signing, '1'))):
                abort('Compose did not inject the expected Stripe settings.')
            subprocess.run(['bash', str(deploy), release], cwd=directory, env=child_env, check=True)
        except BaseException:
            for path in (env_file, override):
                saved = backup / path.name
                if saved.exists():
                    shutil.copy2(saved, path)
                elif path.exists():
                    path.unlink()
            # The inner deploy restores the previous source and image; restart with the original environment.
            subprocess.run(['docker', 'compose', 'up', '-d', '--no-build', '--no-deps', 'api'],
                           cwd=directory, env=child_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            abort('Activation failed. Previous environment restored; check the API service. Credentials were not printed.')
    print('Stripe Checkout is enabled. No test payment, registration or email was created.')
    print('Open https://www.inexctraining.com/register/ and select a course to see Stripe.')
    print('Protected configuration backup: ' + str(backup))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, KeyboardInterrupt) as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Activation stopped; credentials were not printed.', file=sys.stderr)
        sys.exit(1)
