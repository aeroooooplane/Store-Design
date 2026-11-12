import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
export const MODEL = 'qwen3-vl-plus'
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// 这里只准备已确认的文件，不读取目录中的其它图、旧标签或本地预测。
export function prepareRequests({ manifestBytes, promptBytes, approval, images }) {
  assert.equal(approval.approved, true, '本轮外发未授权')
  assert.equal(approval.region, 'cn-beijing', '地域不符')
  assert.equal(approval.endpoint, ENDPOINT, '只允许已声明的北京接口')
  assert.equal(approval.model, MODEL, '模型与本次执行不符')
  assert.equal(approval.manifestSha256, sha256(manifestBytes), '清单在确认后变化')
  assert.equal(approval.promptSha256, sha256(promptBytes), '提示词在确认后变化')
  const manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''))
  assert.equal(manifest.files.length, 3, '本轮只允许3张图')
  assert.equal(approval.files.length, 3, '授权必须逐图限定')
  assert.equal(images.length, 3, '图片数量不符')
  assert.equal(new Set(manifest.files.map((f) => f.case)).size, 3, '样本编号重复')
  return manifest.files.map((file, index) => {
    assert.equal(file.case, `case-${index + 1}`, '匿名编号不符')
    assert.equal(file.file, `${file.case}.png`, '只读取固定匿名PNG文件')
    const image = images[index]
    assert.equal(image.name, file.file, '图片顺序不符')
    assert.equal(sha256(image.bytes), file.sha256, '图片指纹不符')
    assert.ok(
      approval.files.some((a) => a.case === file.case && a.sha256 === file.sha256),
      '图片未获授权',
    )
    assert.ok(image.bytes.length < 20 * 1024 * 1024, '图片过大')
    assert.equal(image.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '不是PNG')
    const width = image.bytes.readUInt32BE(16),
      height = image.bytes.readUInt32BE(20)
    assert.deepEqual([width, height], file.size, '图片尺寸不符')
    const request = {
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${image.bytes.toString('base64')}` },
            },
            {
              type: 'text',
              text: `${promptBytes.toString('utf8').trim()}\n样本：${file.case}。图片宽${width}像素，高${height}像素。`,
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      enable_thinking: false,
      temperature: 0.1,
      max_tokens: 8192,
      stream: false,
    }
    return {
      caseId: file.case,
      imageSha256: file.sha256,
      width,
      height,
      request,
      requestSha256: sha256(JSON.stringify(request)),
    }
  })
}

export function extractAnswer(response) {
  assert.equal(response.choices?.length, 1, '响应缺少唯一答案')
  assert.equal(response.choices[0].finish_reason, 'stop', '答案未完整生成')
  const content = response.choices[0].message?.content
  assert.equal(typeof content, 'string', '响应内容不是文本')
  // 不做截取/补括号修复，保持原始模型输出可审计。
  const parsed = JSON.parse(content)
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), '答案不是JSON对象')
  return parsed
}
