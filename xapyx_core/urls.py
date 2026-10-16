from django.contrib import admin
from django.urls import path, include
from django.shortcuts import render

def custom_page_not_found_view(request, exception=None):
    return render(request, '404.html', status=404)

handler404 = custom_page_not_found_view

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('landing.urls')),
]
