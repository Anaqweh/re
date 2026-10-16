"""Isolated activation tests; no Docker, network or actual secrets."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('stripe_deploy', Path(__file__).with_name('deploy-stripe-checkout.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class ActivationTests(unittest.TestCase):
    def test_environment_preserves_other_settings_without_evaluating_them(self):
        original = '# existing\nDATABASE_URL="local"\nOTHER=$(do-not-execute)\nSTRIPE_SECRET_KEY=old\nSTRIPE_CHECKOUT_ENABLED=0\n'
        updated = deploy.update_env(original, dict(zip(deploy.KEYS, ('rk_live_LOCAL', 'whsec_LOCAL', '1'))))
        self.assertIn('OTHER=$(do-not-execute)\n', updated)
        self.assertIn('DATABASE_URL="local"\n', updated)
        self.assertEqual(updated.count('STRIPE_SECRET_KEY='), 1)
        self.assertEqual(deploy.existing_value(updated, 'STRIPE_SECRET_KEY'), 'rk_live_LOCAL')

    def test_unowned_override_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            directory = Path(temporary)
            (directory / 'compose.yaml').write_text('services: {}')
            (directory / 'compose.override.yaml').write_text('services: {api: {}}')
            with self.assertRaisesRegex(RuntimeError, 'existing Compose override'):
                deploy.compose_override(directory)
            self.assertEqual((directory / 'compose.override.yaml').read_text(), 'services: {api: {}}')

    def test_activation_and_rollback_keep_credentials_private(self):
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                (directory / 'compose.yaml').write_text('services: {api: {image: local}}')
                original = 'DATABASE_URL=LOCAL\nSTRIPE_SECRET_KEY=sk_live_OLD_LOCAL\n'
                (directory / '.env').write_text(original)
                calls = []

                def run(args, **kwargs):
                    calls.append(args)
                    if args[:3] == ['docker', 'compose', 'config']:
                        current = (directory / '.env').read_text()
                        environment = {name: deploy.existing_value(current, name) for name in deploy.KEYS}
                        return subprocess.CompletedProcess(args, 0, json.dumps({'services': {'api': {'environment': environment}}}))
                    if args[0] == 'bash' and fail:
                        raise subprocess.CalledProcessError(1, args)
                    return subprocess.CompletedProcess(args, 0)

                def stripe(secret, route, params=None):
                    self.assertEqual(secret, 'rk_live_NEW_LOCAL')
                    if route == 'account':
                        return {'id': 'acct_LOCAL', 'charges_enabled': True}
                    if route.startswith('webhook_endpoints?'):
                        return {'data': [], 'has_more': False}
                    self.assertEqual(params['url'], deploy.ENDPOINT)
                    return {'secret': 'whsec_NEW_LOCAL'}

                output = io.StringIO()
                with patch.dict(os.environ, {'INEXC_API_DIR': temporary}, clear=True), \
                        patch('sys.argv', ['deploy', 'a' * 40]), patch('sys.stdin.isatty', return_value=True), \
                        patch.object(deploy.subprocess, 'run', side_effect=run), \
                        patch.object(deploy.urllib.request, 'urlopen', return_value=io.BytesIO(b'#!/bin/bash\nexit 0')), \
                        patch.object(deploy.getpass, 'getpass', return_value='rk_live_NEW_LOCAL'), \
                        patch.object(deploy, 'stripe_request', side_effect=stripe), contextlib.redirect_stdout(output):
                    if fail:
                        with self.assertRaisesRegex(RuntimeError, 'Previous environment restored'):
                            deploy.main()
                    else:
                        deploy.main()
                self.assertNotIn('rk_live_NEW_LOCAL', output.getvalue())
                self.assertNotIn('whsec_NEW_LOCAL', output.getvalue())
                if fail:
                    self.assertEqual((directory / '.env').read_text(), original)
                    self.assertFalse((directory / 'compose.override.yaml').exists())
                    self.assertTrue(any(args[:3] == ['docker', 'compose', 'up'] for args in calls))
                else:
                    self.assertEqual((directory / '.env').stat().st_mode & 0o777, 0o600)
                    self.assertEqual((directory / 'compose.override.yaml').stat().st_mode & 0o777, 0o600)
                    override = json.loads((directory / 'compose.override.yaml').read_text())
                    self.assertEqual(override['services']['api']['environment']['STRIPE_CHECKOUT_ENABLED'], '${STRIPE_CHECKOUT_ENABLED:-0}')
                    self.assertNotIn('rk_live_NEW_LOCAL', (directory / 'compose.override.yaml').read_text())


if __name__ == '__main__':
    unittest.main()
