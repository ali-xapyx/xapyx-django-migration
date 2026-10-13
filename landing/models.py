# landing/models.py
from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager


class AuthManager(BaseUserManager):
    """Custom manager so Django knows how to look up users by username."""
    def get_by_natural_key(self, username):
        return self.get(**{self.model.USERNAME_FIELD: username})


class Auth(AbstractBaseUser):
    """
    Maps the existing 'auth' table 1:1.
    No DB changes. Django will never CREATE, ALTER, or DROP this table.
    """
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=100)
    username = models.CharField(max_length=20, unique=True)
    email = models.CharField(max_length=100, unique=True, null=True, blank=True)
    cell = models.CharField(max_length=20, unique=True, null=True, blank=True)
    location = models.CharField(max_length=100, null=True, blank=True)
    gender = models.CharField(max_length=150, null=True, blank=True)
    password = models.CharField(max_length=255)
    pass_org = models.TextField(null=True, blank=True)
    picture = models.CharField(max_length=255, null=True, blank=True)
    hobbies = models.TextField(null=True, blank=True)
    role = models.CharField(
        max_length=20,
        choices=[('admin', 'Admin'), ('moderator', 'Moderator'), ('user', 'User')],
        default='user',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    about_me = models.TextField(null=True, blank=True)
    join_date = models.DateField(auto_now_add=True)
    birthday = models.DateField(null=True, blank=True)
    website = models.CharField(max_length=255, null=True, blank=True)
    language = models.CharField(max_length=50, default='English')
    timezone = models.CharField(max_length=100, default='Asia/Karachi')
    profile_visibility = models.CharField(max_length=20, default='public')
    facebook = models.CharField(max_length=255, null=True, blank=True)
    instagram = models.CharField(max_length=255, null=True, blank=True)
    twitter = models.CharField(max_length=255, null=True, blank=True)
    linkedin = models.CharField(max_length=255, null=True, blank=True)
    youtube = models.CharField(max_length=255, null=True, blank=True)
    color = models.CharField(max_length=50, null=True, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    last_login = models.DateTimeField(null=True, blank=True)
    theme_mode = models.CharField(max_length=10, default='light')
    theme_color = models.CharField(max_length=20, default='#3498db')
    theme_config = models.TextField(null=True, blank=True)
    google_id = models.CharField(max_length=255, unique=True, null=True, blank=True)
    google_picture = models.CharField(max_length=500, null=True, blank=True)
    google_email_verified = models.BooleanField(default=False)
    auth_method = models.CharField(max_length=10, default='email')

    # ---- Django auth integration ----
    objects = AuthManager()

    USERNAME_FIELD = 'username'
    REQUIRED_FIELDS = []
    EMAIL_FIELD = 'email'

    class Meta:
        db_table = 'auth'
        managed = False  # CRITICAL: Django will not touch this table

    def __str__(self):
        return self.username

    # Computed properties — no DB columns needed
    @property
    def is_active(self):
        return True

    @property
    def is_staff(self):
        return self.role in ('admin', 'moderator')

    @property
    def is_superuser(self):
        return self.role == 'admin'

    @property
    def date_joined(self):
        return self.created_at

    # Admin panel permissions (no-op unless role is admin)
    def has_perm(self, perm, obj=None):
        return self.role == 'admin'

    def has_module_perms(self, app_label):
        return self.role == 'admin'

    def get_full_name(self):
        return self.name or self.username

    def get_short_name(self):
        return self.username


class Shout(models.Model):
    """Maps the existing 'shouts' table 1:1."""
    id = models.AutoField(primary_key=True)
    user = models.ForeignKey(
        Auth,
        on_delete=models.CASCADE,
        db_column='user_id',
        related_name='shouts',
    )
    message = models.CharField(max_length=140)
    created_at = models.DateTimeField(auto_now_add=True)
    is_deleted = models.BooleanField(default=False)
    mention_count = models.IntegerField(default=0)
    mentioned_users = models.TextField(null=True, blank=True)

    class Meta:
        db_table = 'shouts'
        managed = False  # CRITICAL: Django will not touch this table

    def __str__(self):
        return f"{self.user.username}: {self.message[:40]}"