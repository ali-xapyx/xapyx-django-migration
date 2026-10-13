from celery import shared_task
import logging
logger = logging.getLogger(__name__)

@shared_task(name='landing.ping')
def ping(message='pong'):
    logger.info(f'Celery ping task ran: {message}')
    return {'status': 'ok', 'message': message}

@shared_task(name='landing.push_notification')
def send_push_notification(user_id, title, body, link=None, notif_id=None,
                            actor_id=None, actor_name=None, actor_username=None,
                            actor_picture=None, notif_type=None, overwrite=False, **kwargs):
    """Wrapper around existing firebase_push logic with enriched actor & time data."""
    from landing.firebase_push import push_notification
    from datetime import datetime
    try:
        if notif_id is None:
            logger.error('send_push_notification called without notif_id')
            return {'ok': False, 'error': 'missing notif_id'}

        full_actor_pic = actor_picture or ''
        if full_actor_pic and not (str(full_actor_pic).startswith('http://') or str(full_actor_pic).startswith('https://')):
            act_str = str(full_actor_pic).strip()
            if act_str.startswith('uploads/'):
                full_actor_pic = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{act_str}'
            elif act_str:
                full_actor_pic = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{act_str}'

        data = {
            'id': str(notif_id),
            'title': title,
            'message': body,
            'link': link or '/feed/',
            'is_read': 0,
            'type': notif_type or 'general',
            'actor_id': actor_id,
            'actor_name': actor_name or '',
            'actor_username': actor_username or '',
            'actor_picture': full_actor_pic,
            'created_at': int(datetime.utcnow().timestamp()),
        }
        push_notification(user_id=user_id, notification_id=notif_id, data=data, overwrite=overwrite)
        return {'ok': True, 'user_id': user_id}
    except Exception as e:
        logger.exception(f'Push failed for user {user_id}')
        return {'ok': False, 'error': str(e)}

@shared_task(name='landing.generate_image_variants')
def generate_image_variants(s3_key, variants=None):
    """
    Download original from S3, generate WebP variants, upload back.
    s3_key: e.g. 'uploads/space_posts/abc.jpg'
    Returns dict of {variant_name: public_url}
    """
    import boto3, os, io
    from PIL import Image
    from dotenv import load_dotenv
    from pathlib import Path

    load_dotenv(Path('/home/bitnami/xapyx_python/.env'))

    bucket = os.environ.get('AWS_STORAGE_BUCKET_NAME')
    region = os.environ.get('AWS_S3_REGION_NAME', 'eu-west-1')
    s3 = boto3.client(
        's3', region_name=region,
        aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
        aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
    )

    # Download original
    obj = s3.get_object(Bucket=bucket, Key=s3_key)
    img = Image.open(io.BytesIO(obj['Body'].read()))
    if img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGB')

    sizes = {
        'avatar': 150,
        'feed': 800,
    }
    base = s3_key.rsplit('.', 1)[0]  # strip extension
    result = {}
    for name, width in sizes.items():
        # Copy image, resize preserving aspect ratio
        variant = img.copy()
        if variant.width > width:
            ratio = width / variant.width
            new_height = int(variant.height * ratio)
            variant = variant.resize((width, new_height), Image.LANCZOS)

        buf = io.BytesIO()
        variant.save(buf, format='WEBP', quality=82, method=6)
        buf.seek(0)

        variant_key = f'{base}_{name}.webp'
        s3.put_object(
            Bucket=bucket, Key=variant_key,
            Body=buf.getvalue(),
            ContentType='image/webp',
            CacheControl='public, max-age=31536000',
        )
        result[name] = f'https://s3.{region}.amazonaws.com/{bucket}/{variant_key}'

    return {'success': True, 'variants': result}

