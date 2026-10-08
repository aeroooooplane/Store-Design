"""Auditable batch-size-one image geometry and content-only noise loss."""
import math

import numpy as np
from PIL import Image, ImageOps
import torch
import torch.nn.functional as F


def prepare_image(image, max_side, policy):
    if max_side < 64 or max_side % 64:
        raise ValueError('max_side must be a positive multiple of 64')
    if policy not in ('center-crop', 'keep-aspect'):
        raise ValueError('Unknown image policy')
    image = ImageOps.exif_transpose(image).convert('RGB')
    width, height = image.size
    info = {'policy': policy, 'source_size': [width, height]}
    if policy == 'center-crop':
        result = ImageOps.fit(image, (max_side, max_side), method=Image.Resampling.LANCZOS)
        mask = np.ones((max_side, max_side), dtype=np.float32)
        info.update(resized_size=[max_side, max_side], output_size=[max_side, max_side],
                    content_box=[0, 0, max_side, max_side], padding_fraction=0.,
                    crop_fraction=1 - min(width, height) / max(width, height))
        return result, mask, info
    scale = max_side / max(width, height)
    rw, rh = max(1, round(width * scale)), max(1, round(height * scale))
    ow, oh = math.ceil(rw / 64) * 64, math.ceil(rh / 64) * 64
    left, top = (ow - rw) // 2, (oh - rh) // 2
    pixels = np.asarray(image.resize((rw, rh), Image.Resampling.LANCZOS))
    # Edge replication avoids a solid gray band, but padding remains invalid for loss.
    padded = np.pad(pixels, ((top, oh - rh - top), (left, ow - rw - left), (0, 0)), mode='edge')
    mask = np.zeros((oh, ow), dtype=np.float32)
    mask[top:top + rh, left:left + rw] = 1
    info.update(resized_size=[rw, rh], output_size=[ow, oh],
                content_box=[left, top, left + rw, top + rh],
                padding_fraction=1 - rw * rh / (ow * oh), crop_fraction=0.,
                padding_mode='edge', rounding_note='Aspect ratio preserved to nearest integer pixel')
    return Image.fromarray(padded), mask, info


def latent_mask(pixel_mask, latent_hw, device):
    mask = torch.as_tensor(pixel_mask, dtype=torch.float32, device=device)[None, None]
    # Keep only cells whose entire corresponding pixel block is valid.
    # This is not a guarantee against VAE receptive-field bleed across the boundary.
    return (F.adaptive_avg_pool2d(mask, latent_hw) >= 1.).float()


def masked_mse(prediction, target, mask):
    if prediction.shape != target.shape or mask.shape != (prediction.shape[0], 1, *prediction.shape[2:]):
        raise ValueError('Prediction, target and spatial mask shapes do not match')
    denominator = mask.sum() * prediction.shape[1]
    if denominator.item() <= 0:
        raise ValueError('No fully valid latent cells remain after masking')
    return ((prediction.float() - target.float()).square() * mask).sum() / denominator
