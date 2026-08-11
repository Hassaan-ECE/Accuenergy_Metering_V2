from pathlib import Path
import binascii
import math
import struct
import zlib


ICON_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
SUPERSAMPLE = 4


def blend_pixel(canvas, canvas_size, pixel_x, pixel_y, color):
    if pixel_x < 0 or pixel_y < 0 or pixel_x >= canvas_size or pixel_y >= canvas_size:
        return
    index = (pixel_y * canvas_size + pixel_x) * 4
    source_alpha = color[3] / 255.0
    destination_alpha = canvas[index + 3] / 255.0
    output_alpha = source_alpha + destination_alpha * (1.0 - source_alpha)
    if output_alpha <= 0.0:
        return
    for channel in range(3):
        source_value = color[channel] / 255.0
        destination_value = canvas[index + channel] / 255.0
        output_value = (
            source_value * source_alpha
            + destination_value * destination_alpha * (1.0 - source_alpha)
        ) / output_alpha
        canvas[index + channel] = round(output_value * 255.0)
    canvas[index + 3] = round(output_alpha * 255.0)


def fill_rounded_rectangle(canvas, canvas_size, left, top, right, bottom, radius, color):
    minimum_x = max(0, math.floor(left))
    maximum_x = min(canvas_size - 1, math.ceil(right))
    minimum_y = max(0, math.floor(top))
    maximum_y = min(canvas_size - 1, math.ceil(bottom))
    for pixel_y in range(minimum_y, maximum_y + 1):
        center_y = pixel_y + 0.5
        for pixel_x in range(minimum_x, maximum_x + 1):
            center_x = pixel_x + 0.5
            nearest_x = min(max(center_x, left + radius), right - radius)
            nearest_y = min(max(center_y, top + radius), bottom - radius)
            distance_x = center_x - nearest_x
            distance_y = center_y - nearest_y
            if distance_x * distance_x + distance_y * distance_y <= radius * radius:
                blend_pixel(canvas, canvas_size, pixel_x, pixel_y, color)


def fill_circle(canvas, canvas_size, center_x, center_y, radius, color):
    minimum_x = max(0, math.floor(center_x - radius))
    maximum_x = min(canvas_size - 1, math.ceil(center_x + radius))
    minimum_y = max(0, math.floor(center_y - radius))
    maximum_y = min(canvas_size - 1, math.ceil(center_y + radius))
    radius_squared = radius * radius
    for pixel_y in range(minimum_y, maximum_y + 1):
        distance_y = pixel_y + 0.5 - center_y
        for pixel_x in range(minimum_x, maximum_x + 1):
            distance_x = pixel_x + 0.5 - center_x
            if distance_x * distance_x + distance_y * distance_y <= radius_squared:
                blend_pixel(canvas, canvas_size, pixel_x, pixel_y, color)


def draw_segment(canvas, canvas_size, start, end, width, color):
    radius = width / 2.0
    minimum_x = max(0, math.floor(min(start[0], end[0]) - radius))
    maximum_x = min(canvas_size - 1, math.ceil(max(start[0], end[0]) + radius))
    minimum_y = max(0, math.floor(min(start[1], end[1]) - radius))
    maximum_y = min(canvas_size - 1, math.ceil(max(start[1], end[1]) + radius))
    segment_x = end[0] - start[0]
    segment_y = end[1] - start[1]
    segment_length_squared = segment_x * segment_x + segment_y * segment_y
    for pixel_y in range(minimum_y, maximum_y + 1):
        center_y = pixel_y + 0.5
        for pixel_x in range(minimum_x, maximum_x + 1):
            center_x = pixel_x + 0.5
            if segment_length_squared == 0.0:
                projection = 0.0
            else:
                projection = (
                    (center_x - start[0]) * segment_x
                    + (center_y - start[1]) * segment_y
                ) / segment_length_squared
                projection = min(1.0, max(0.0, projection))
            nearest_x = start[0] + projection * segment_x
            nearest_y = start[1] + projection * segment_y
            distance_x = center_x - nearest_x
            distance_y = center_y - nearest_y
            if distance_x * distance_x + distance_y * distance_y <= radius * radius:
                blend_pixel(canvas, canvas_size, pixel_x, pixel_y, color)


def draw_polyline(canvas, canvas_size, points, width, color):
    for point_index in range(len(points) - 1):
        draw_segment(canvas, canvas_size, points[point_index], points[point_index + 1], width, color)
    for point in points:
        fill_circle(canvas, canvas_size, point[0], point[1], width / 2.0, color)


def render_icon(target_size):
    canvas_size = target_size * SUPERSAMPLE
    canvas = bytearray(canvas_size * canvas_size * 4)
    scale = canvas_size / 256.0

    def scaled(value):
        return value * scale

    fill_rounded_rectangle(
        canvas,
        canvas_size,
        scaled(4),
        scaled(4),
        scaled(252),
        scaled(252),
        scaled(52),
        (11, 18, 32, 255),
    )
    fill_rounded_rectangle(
        canvas,
        canvas_size,
        scaled(18),
        scaled(18),
        scaled(238),
        scaled(238),
        scaled(40),
        (41, 66, 103, 255),
    )
    fill_rounded_rectangle(
        canvas,
        canvas_size,
        scaled(22),
        scaled(22),
        scaled(234),
        scaled(234),
        scaled(36),
        (17, 28, 50, 255),
    )
    draw_polyline(
        canvas,
        canvas_size,
        [(scaled(55), scaled(194)), (scaled(112), scaled(55)), (scaled(171), scaled(194))],
        scaled(18),
        (248, 250, 252, 255),
    )
    draw_polyline(
        canvas,
        canvas_size,
        [
            (scaled(72), scaled(145)),
            (scaled(94), scaled(145)),
            (scaled(107), scaled(118)),
            (scaled(124), scaled(169)),
            (scaled(141), scaled(134)),
            (scaled(154), scaled(145)),
            (scaled(204), scaled(145)),
        ],
        scaled(12),
        (34, 211, 238, 255),
    )
    fill_circle(canvas, canvas_size, scaled(210), scaled(145), scaled(9), (59, 130, 246, 255))
    return downsample(canvas, canvas_size, target_size)


def downsample(canvas, source_size, target_size):
    output = bytearray(target_size * target_size * 4)
    sample_width = source_size // target_size
    sample_count = sample_width * sample_width
    for target_y in range(target_size):
        for target_x in range(target_size):
            totals = [0, 0, 0, 0]
            for sample_y in range(sample_width):
                source_y = target_y * sample_width + sample_y
                for sample_x in range(sample_width):
                    source_x = target_x * sample_width + sample_x
                    source_index = (source_y * source_size + source_x) * 4
                    for channel in range(4):
                        totals[channel] += canvas[source_index + channel]
            output_index = (target_y * target_size + target_x) * 4
            for channel in range(4):
                output[output_index + channel] = round(totals[channel] / sample_count)
    return output


def png_chunk(chunk_type, payload):
    checksum = binascii.crc32(chunk_type + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + chunk_type + payload + struct.pack(">I", checksum)


def encode_png(size, pixels):
    scanlines = bytearray()
    row_bytes = size * 4
    for row_index in range(size):
        scanlines.append(0)
        row_start = row_index * row_bytes
        scanlines.extend(pixels[row_start : row_start + row_bytes])
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(bytes(scanlines), 9))
        + png_chunk(b"IEND", b"")
    )


def encode_ico(images):
    header = struct.pack("<HHH", 0, 1, len(images))
    directory_size = 16 * len(images)
    offset = len(header) + directory_size
    entries = bytearray()
    payload = bytearray()
    for size, image in images:
        dimension = 0 if size == 256 else size
        entries.extend(
            struct.pack(
                "<BBBBHHII",
                dimension,
                dimension,
                0,
                0,
                1,
                32,
                len(image),
                offset,
            )
        )
        payload.extend(image)
        offset += len(image)
    return header + bytes(entries) + bytes(payload)


def main():
    images = [(size, encode_png(size, render_icon(size))) for size in ICON_SIZES]
    output_path = Path(__file__).with_name("icon.ico")
    output_path.write_bytes(encode_ico(images))
    print(f"Wrote {output_path} ({output_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
