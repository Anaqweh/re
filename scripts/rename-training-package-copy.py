#!/usr/bin/env python3
"""Stage wording-only changes against the API files already on the server."""
import argparse
import re
from pathlib import Path

API_FILES = ('server.js', 'learner-service.js', 'membership-payments.js', 'course-payment.js', 'stripe-payments.js')
HELPER = "function trainingPackageText(value){return String(value??'').replaceAll('بطاق','باق');}\n"

def rename_copy(source):
    # This is a persisted registration status, not a display label. Keep its
    # exact value so existing records, filters and payment workflows still work.
    source = source.replace('مسجل بالبطاقة', '__INEXC_STORED_MEMBERSHIP_STATUS__')
    source = source.replace('بطاق', 'باق')
    return source.replace('__INEXC_STORED_MEMBERSHIP_STATUS__', 'مسجل بالبطاقة')

def transform(name, source):
    if name not in API_FILES:
        raise ValueError('Unexpected API file')
    # Idempotent: preserve the helper's intentionally old-name matching token.
    had_helper = HELPER in source
    if had_helper:
        source = source.replace(HELPER, '')
    source = rename_copy(source)
    if name in ('server.js', 'learner-service.js', 'membership-payments.js'):
        source = HELPER + source
    if name == 'server.js':
        start = source.index('function membershipPlanPublic(')
        end = source.index('\nasync function membershipPlans(', start)
        block = source[start:end]
        for field in ('name', 'perks', 'feature_lines', 'badge_text', 'stock_label', 'low_stock_label'):
            block = re.sub(r'(?<!trainingPackageText\()row\.' + field + r'\b', 'trainingPackageText(row.' + field + ')', block)
        source = source[:start] + block + source[end:]
        source = source.replace('({...r,total:Number(r.total)})', '({...r,plan_name:trainingPackageText(r.plan_name),total:Number(r.total)})')
        source = source.replace('({...r,units_total:Number(r.units_total)', '({...r,plan_name:trainingPackageText(r.plan_name),units_total:Number(r.units_total)')
        source = source.replace('r.total,r.payment_method,r.status,r.request_kind', 'r.total,r.payment_method,trainingPackageText(r.status),r.request_kind')
        if 'trainingPackageLabelsVersion: 1' not in source:
            source = source.replace("service: 'INEXC Training API',", "service: 'INEXC Training API', trainingPackageLabelsVersion: 1,")
    elif name == 'learner-service.js':
        source = source.replace('planName:c.plan_name,', 'planName:trainingPackageText(c.plan_name),')
        source = source.replace('escapeHtml(card.plan_name)', 'escapeHtml(trainingPackageText(card.plan_name))')
        source = source.replace('${card.plan_name}:', '${trainingPackageText(card.plan_name)}:')
    elif name == 'membership-payments.js':
        source = source.replace("[product_data][name]':plan.name", "[product_data][name]':trainingPackageText(plan.name)")
        source = source.replace('snapshot={name:plan.name,', 'snapshot={name:trainingPackageText(plan.name),')
        source = source.replace('planName:row.plan_snapshot.name,', 'planName:trainingPackageText(row.plan_snapshot.name),')
    return source

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    inputs = {name: (args.source / name).read_text() for name in API_FILES}
    outputs = {name: transform(name, value) for name, value in inputs.items()}
    args.destination.mkdir(parents=True, exist_ok=True)
    for name, value in outputs.items():
        (args.destination / name).write_text(value)
    print('Staged training-package wording. No settings, records, orders or emails were changed.')

if __name__ == '__main__':
    main()
