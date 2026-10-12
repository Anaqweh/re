"""Small, offline helpers for legacy Excel and bounded image preparation."""
import json
import resource
import sys

resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (18, 18))

if sys.argv[1] == 'xls':
    import xlrd
    book = xlrd.open_workbook(sys.argv[2], on_demand=True, logfile=sys.stderr)
    try:
        if book.nsheets > 30:
            raise ValueError('Too many worksheets')
        sheets = []
        total_cells = 0
        for sheet_index in range(book.nsheets):
            sheet = book.sheet_by_index(sheet_index)
            total_cells += sheet.nrows * sheet.ncols
            if total_cells > 500000:
                raise ValueError('Too many cells')
            sheets.append([[str(value) if value is not None else '' for value in sheet.row_values(row)] for row in range(sheet.nrows)])
            book.unload_sheet(sheet_index)
        print(json.dumps(sheets, ensure_ascii=False))
    finally:
        book.release_resources()
elif sys.argv[1] == 'image':
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 20000000
    with Image.open(sys.argv[2]) as image:
        if image.width * image.height > Image.MAX_IMAGE_PIXELS:
            raise ValueError('Image dimensions are too large')
        if getattr(image, 'n_frames', 1) > 1:
            raise ValueError('Upload each image page separately')
        image = ImageOps.exif_transpose(image)
        image.thumbnail((2600, 2600))
        image.convert('RGB').save(sys.argv[3], 'PNG')
else:
    raise ValueError('Unknown reader mode')
