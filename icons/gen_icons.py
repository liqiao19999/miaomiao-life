"""用 Python 标准库生成应用 PNG 图标（无第三方依赖）。"""
import zlib, struct, math, os

def make_icon(size, path):
    # 画布
    px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]

    def blend(x, y, color, alpha=1.0):
        if 0 <= x < size and 0 <= y < size:
            r, g, b = color
            a = int(alpha * 255)
            px[y][x] = (r, g, b, a)

    def rounded_rect(x0, y0, x1, y1, radius, color_fn):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                # 圆角判定
                cx = min(max(x, x0 + radius), x1 - radius)
                cy = min(max(y, y0 + radius), y1 - radius)
                if (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2:
                    blend(x, y, color_fn(x, y))

    def fill_circle(cx, cy, r, color):
        for y in range(int(cy - r), int(cy + r) + 1):
            for x in range(int(cx - r), int(cx + r) + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2:
                    blend(x, y, color)

    def fill_triangle(p0, p1, p2, color):
        def sign(a, b, c): return (a[0]-c[0])*(b[1]-c[1]) - (b[0]-c[0])*(a[1]-c[1])
        minx = int(min(p0[0], p1[0], p2[0])); maxx = int(max(p0[0], p1[0], p2[0]))
        miny = int(min(p0[1], p1[1], p2[1])); maxy = int(max(p0[1], p1[1], p2[1]))
        for y in range(miny, maxy + 1):
            for x in range(minx, maxx + 1):
                pt = (x, y)
                d1, d2, d3 = sign(pt, p0, p1), sign(pt, p1, p2), sign(pt, p2, p0)
                neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
                pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
                if not (neg and pos):
                    blend(x, y, color)

    def stroke_line(x0, y0, x1, y1, width, color):
        steps = int(max(abs(x1-x0), abs(y1-y0))) + 1
        for i in range(steps + 1):
            t = i / steps
            cx = x0 + (x1-x0)*t; cy = y0 + (y1-y0)*t
            fill_circle(cx, cy, width/2, color)

    S = size
    # 渐变蓝底圆角矩形
    def bg(x, y):
        t = (x + y) / (2*S)
        return (int(10 + (0-10)*t), int(132 + (96-132)*t), int(255 + (223-255)*t))
    rounded_rect(0, 0, S, S, int(S*0.22), bg)

    white = (255, 255, 255)
    dark = (28, 30, 33)
    gold = (255, 176, 32)

    # 猫耳
    fill_triangle((S*0.28, S*0.30), (S*0.36, S*0.13), (S*0.50, S*0.27), white)
    fill_triangle((S*0.72, S*0.30), (S*0.64, S*0.13), (S*0.50, S*0.27), white)
    # 猫脸
    fill_circle(S*0.5, S*0.55, S*0.30, white)
    # 眼睛
    fill_circle(S*0.40, S*0.51, S*0.035, dark)
    fill_circle(S*0.60, S*0.51, S*0.035, dark)
    # 嘴（两条弧简化为 V）
    stroke_line(S*0.46, S*0.60, S*0.50, S*0.63, S*0.018, dark)
    stroke_line(S*0.50, S*0.63, S*0.54, S*0.60, S*0.018, dark)
    # 顶部金币 ¥
    fill_circle(S*0.5, S*0.235, S*0.075, gold)
    # ¥ 的两横和一竖（简化）
    stroke_line(S*0.465, S*0.205, S*0.535, S*0.205, S*0.012, white)
    stroke_line(S*0.465, S*0.225, S*0.535, S*0.225, S*0.012, white)
    stroke_line(S*0.5, S*0.19, S*0.5, S*0.27, S*0.012, white)

    # 写 PNG
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter none
        for x in range(size):
            r, g, b, a = px[y][x]
            raw += bytes((r, g, b, a))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print('generated', path, os.path.getsize(path), 'bytes')

base = os.path.dirname(__file__)
make_icon(192, os.path.join(base, 'icon-192.png'))
make_icon(512, os.path.join(base, 'icon-512.png'))
