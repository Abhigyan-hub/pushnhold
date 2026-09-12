import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { config } from './config.js'

let client

function credentialsError(err) {
  const msg = err?.message || String(err)
  if (msg.includes('Could not load credentials') || err?.name === 'CredentialsProviderError') {
    return new Error(
      'S3 is not configured on EC2. Attach an IAM instance role with s3:PutObject, or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in backend/.env, then restart cascade-api. You can still create events without images.'
    )
  }
  return err
}

function getS3() {
  if (!client) {
    const options = { region: config.awsRegion }
    if (config.awsAccessKeyId && config.awsSecretAccessKey) {
      options.credentials = {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
      }
    }
    client = new S3Client(options)
  }
  return client
}

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
    throw new Error('S3_BUCKET is not set on the server')
  }
  try {
    await getS3().send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    )
  } catch (err) {
    throw credentialsError(err)
  }
  return key
}

export async function deleteEventImage(key) {
  if (!config.s3Bucket || !key) return
  try {
    await getS3().send(
      new DeleteObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
      })
    )
  } catch (err) {
    console.error('deleteEventImage', credentialsError(err).message)
  }
}
