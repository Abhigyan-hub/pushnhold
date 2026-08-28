import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { config } from './config.js'

export const s3 = new S3Client({
  region: config.awsRegion,
})

export function publicImageUrl(storagePath) {
  if (!storagePath) return null
  if (config.s3PublicBaseUrl) {
    return `${config.s3PublicBaseUrl.replace(/\/$/, '')}/${storagePath}`
  }
  if (!config.s3Bucket) return null
  return `https://${config.s3Bucket}.s3.${config.awsRegion}.amazonaws.com/${storagePath}`
}

export function withImageUrls(images = []) {
  return images.map((img) => ({
    ...img,
    public_url: publicImageUrl(img.storage_path),
  }))
}

export async function uploadEventImage(key, body, contentType) {
  if (!config.s3Bucket) {
    throw new Error('S3_BUCKET is not configured')
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
  return key
}

export async function deleteEventImage(key) {
  if (!config.s3Bucket || !key) return
  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
    })
  )
}
