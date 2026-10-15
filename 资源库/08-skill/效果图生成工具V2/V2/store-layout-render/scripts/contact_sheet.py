"""Spatial overview contact sheet. Missing views remain explicit placeholders."""
from pathlib import Path
import math


def make_sheet(directory, views):
    from PIL import Image, ImageDraw, ImageFont
    directory = Path(directory)
    width, height, columns = 600, 440, 2
    sheet = Image.new('RGB', (width * columns, 60 + math.ceil(len(views) / columns) * height), '#edf0f3')
    draw = ImageDraw.Draw(sheet)
    font_file = Path('C:/Windows/Fonts/msyh.ttc')
    font = ImageFont.truetype(str(font_file), 19) if font_file.exists() else ImageFont.load_default(size=19)
    title = '空间关系校核 | 前后左右 + 俯视 | 低清预览，非正式效果图' if font_file.exists() else 'SPACE CHECK | SAME 3D SCENE | PREVIEW ONLY'
    draw.text((20, 18), title, fill='#243244', font=font)
    missing = []
    for index, view in enumerate(views):
        x, y = (index % columns) * width, 60 + (index // columns) * height
        label = view.get('label', view['id']) if font_file.exists() else view['id']
        draw.text((x + 16, y + 10), label, fill='#243244', font=font)
        path = directory / 'material' / (view['id'] + '.png')
        if not path.exists():
            missing.append(view['id'])
            draw.text((x + 20, y + 140), 'MISSING: ' + view['id'], fill='#b32828', font=font)
            continue
        with Image.open(path) as image:
            image = image.convert('RGB')
            image.thumbnail((576, 384))
            sheet.paste(image, (x + (width - image.width) // 2, y + 44))
    output = directory / 'preview-contact.jpg'
    sheet.save(output, quality=92)
    return {'file': str(output), 'views': len(views), 'missing': missing}
