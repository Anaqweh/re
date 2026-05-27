import re

path = r'g:\re\invoice.html'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

text = re.sub(
    r"const IMG_LOGO = '[^']*';",
    "const IMG_LOGO = 'assets/images/inexc-logo-white.png';",
    text,
    count=1,
)

text = text.replace(
    '.header-logo img { height: 72px; width: auto; object-fit: contain; }',
    '.header-logo { display:inline-flex; align-items:center; justify-content:center; background:#1B2A4A; padding:10px 16px; border-radius:8px; line-height:0; }\n'
    '    .header-logo img { height: 56px; width: auto; object-fit: contain; display: block; background: transparent; }',
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)

print('invoice updated')
