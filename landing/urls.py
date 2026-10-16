# landing/urls.py
from django.urls import path
from . import views
from . import admin_views
urlpatterns = [
    #Default load page
    path('', views.landing_page, name='landing'),

    #User count
    path('ajax/user-count/', views.ajax_get_user_count, name='ajax_user_count'),

    #latest user
    path('ajax/latest-user/', views.ajax_get_latest_user, name='ajax_latest_user'),

    #new shouts
    path('ajax/new-shouts/', views.ajax_get_new_shouts, name='ajax_new_shouts'),

    #stats view
    path('ajax/stats/', views.ajax_get_stats, name='ajax_get_stats'),

    #Landing page
    path('ajax/landing-live/', views.ajax_landing_live, name='ajax_landing_live'),

    #Feed Page
    path('feed/', views.feed_view, name='feed'),
    path('dashboard/', views.feed_view, name='dashboard'),
    path('notifications/', views.notifications_page, name='notifications_page'),

    # Authentication pages
    path('login/', views.login_view, name='login'),
    path('auth/google/callback/', views.google_auth_callback, name='google_auth_callback'),
    path('google-auth/', views.google_auth_callback, name='google_auth_legacy'),
    path('signup/', views.signup_view, name='signup'),
    path('logout/', views.logout_view, name='logout'),

    # Auth check endpoints
    path('ajax/check-username/', views.ajax_check_username, name='ajax_check_username'),
    path('ajax/check-email/', views.ajax_check_email, name='ajax_check_email'),
    path('ajax/check-phone/', views.ajax_check_phone, name='ajax_check_phone'),

    #suggest username
    path('ajax/suggest-username/', views.ajax_suggest_username, name='ajax_suggest_username'),
    
    # API Posts endpoints
    path('api/posts/', views.api_posts_list, name='api_posts_list'),
    path('api/posts/create/', views.api_posts_create, name='api_posts_create'),
    path('api/posts/react/', views.api_posts_react, name='api_posts_react'),
    path('api/posts/save/', views.api_posts_save, name='api_posts_save'),
    path('api/posts/view/', views.api_posts_view, name='api_posts_view'),
    path('api/posts/<int:post_id>/view/', views.api_increment_view, name='api_increment_view'),
    path('api/posts/comments/', views.api_posts_get_comments, name='api_posts_get_comments'),
    path('api/posts/comments/add/', views.api_posts_add_comment, name='api_posts_add_comment'),
    path('api/posts/comments/delete/', views.api_posts_delete_comment, name='api_posts_delete_comment'),
    path('api/posts/vote/', views.api_posts_vote_poll, name='api_posts_vote_poll'),
    path('api/posts/delete/', views.api_posts_delete, name='api_posts_delete'),
    path('api/posts/count/', views.api_posts_get_count, name='api_posts_get_count'),
    path('api/posts/get/', views.api_posts_get, name='api_posts_get'),
    path('api/posts/edit/', views.api_posts_edit, name='api_posts_edit'),
    path('api/upload/presign/', views.api_upload_presign, name='api_upload_presign'),       
    path('api/user/theme/', views.api_user_theme, name='api_user_theme'),

    #Api notifications
    path('api/notifications/count/', views.api_notifications_count, name='api_notifications_count'),
    path('api/sidebar/counts/', views.api_sidebar_counts, name='api_sidebar_counts'),
    path('api/notifications/delete/', views.api_notifications_delete, name='api_notifications_delete'),
    path('api/notifications/mark-read/<int:notif_id>/', views.api_notifications_mark_read, name='api_notifications_mark_read'),
    path('api/notifications/read-all/', views.api_notifications_read_all, name='api_notifications_read_all'),
    path('api/notifications/list/', views.api_notifications_list, name='api_notifications_list'),
    path('api/notifications/page/', views.api_notifications_page, name='api_notifications_page'),
    path('api/notifications/clear-all/', views.api_notifications_clear_all, name='api_notifications_clear_all'),


    #API for friends endpoint
    # Friends page
    path('friends/', views.friends_view, name='friends'),
    path('api/friends/counts/', views.api_friends_counts, name='api_friends_counts'),
    path('api/friends/check/', views.api_friends_check, name='api_friends_check'),
    path('api/friends/get-friend-id/', views.api_friends_get_id, name='api_friends_get_id'),
    path('api/friends/send-request/', views.api_friends_send_request, name='api_friends_send_request'), 
    path('api/friends/accept/', views.api_friends_accept, name='api_friends_accept'),
    path('api/friends/decline/', views.api_friends_decline, name='api_friends_decline'),
    path('api/friends/cancel/', views.api_friends_cancel, name='api_friends_cancel'),
    path('api/friends/remove/', views.api_friends_remove, name='api_friends_remove'),
    path('api/friends/list/', views.api_friends_list, name='api_friends_list'),
    path('api/friends/pending/', views.api_friends_pending, name='api_friends_pending'),
    path('api/friends/sent/', views.api_friends_sent, name='api_friends_sent'),
    path('api/friends/suggested/', views.api_friends_suggested, name='api_friends_suggested'),
    path('api/friends/search/', views.api_friends_search, name='api_friends_search'),
    path('api/friends/recent-activity/', views.api_friends_recent_activity, name='api_friends_recent_activity'),

    # Profile page
    path('user/<int:user_id>/', views.user_profile_view, name='user_profile'),
    path('user/<str:username>/', views.user_profile_view, name='user_profile_by_name'),
    path('profile/', views.user_profile_view, name='my_profile'), 

    # Profile API
    path('api/profile/action/', views.api_profile_action, name='api_profile_action'),
    path('api/user-posts/', views.api_user_posts_list, name='api_user_posts_list'),

    # Single post view
    path('post/<int:post_id>/', views.view_post_view, name='view_post'),

    # Shout Box
    path('shoutbox/', views.shoutbox_view, name='shoutbox'),
    path('api/shouts/list/', views.api_shouts_list, name='api_shouts_list'),
    path('api/shouts/friends/', views.api_shouts_friends, name='api_shouts_friends'),
    path('api/shouts/create/', views.api_shouts_create, name='api_shouts_create'),
    path('api/shouts/delete/', views.api_shouts_delete, name='api_shouts_delete'),

    # Leaderboard
    path('leaderboard/', views.leaderboard_view, name='leaderboard'),
    path('api/leaderboard/status/', views.api_lb_status, name='api_lb_status'),
    path('api/leaderboard/promotions/', views.api_lb_promotions, name='api_lb_promotions'),
    path('api/leaderboard/create/', views.api_lb_create, name='api_lb_create'),
    path('api/leaderboard/activate/', views.api_lb_activate, name='api_lb_activate'),
    path('api/leaderboard/deactivate/', views.api_lb_deactivate, name='api_lb_deactivate'),
    path('api/leaderboard/reset/', views.api_lb_reset, name='api_lb_reset'),
    path('api/leaderboard/delete/', views.api_lb_delete, name='api_lb_delete'),

    # Support
    path('support/', views.support_view, name='support'),
    path('api/support/tickets/', views.api_support_tickets, name='api_support_tickets'),
    path('api/support/messages/', views.api_support_messages, name='api_support_messages'),
    path('api/support/create-ticket/', views.api_support_create_ticket, name='api_support_create_ticket'),
    path('api/support/save-message/', views.api_support_save_message, name='api_support_save_message'),
    path('api/support/upload-media/', views.api_support_upload_media, name='api_support_upload_media'),
    path('api/support/mark-read/', views.api_support_mark_read, name='api_support_mark_read'),

    # Groups
    path('groups/', views.groups_view, name='groups'),
    path('groups/<int:group_id>/', views.group_view_view, name='group_view'),
    path('api/groups/list/', views.api_groups_list, name='api_groups_list'),
    path('api/groups/create/', views.api_groups_create, name='api_groups_create'),
    path('api/groups/<int:group_id>/edit/', views.api_groups_edit, name='api_groups_edit'),
    path('api/groups/<int:group_id>/delete/', views.api_groups_delete, name='api_groups_delete'),
    path('api/groups/<int:group_id>/join/', views.api_groups_join, name='api_groups_join'),
    path('api/groups/<int:group_id>/leave/', views.api_groups_leave, name='api_groups_leave'),
    path('api/groups/<int:group_id>/request-join/', views.api_groups_request_join, name='api_groups_request_join'),
    path('api/groups/<int:group_id>/pending-posts/', views.api_groups_pending_posts, name='api_groups_pending_posts'),
    path('api/groups/<int:group_id>/posts/', views.api_groups_posts_list, name='api_groups_posts_list'),
    path('api/groups/<int:group_id>/posts/create/', views.api_groups_posts_create, name='api_groups_posts_create'),
    path('api/groups/<int:group_id>/members/', views.api_groups_members, name='api_groups_members'),
    path('api/groups/posts/<int:post_id>/approve/', views.api_groups_post_approve, name='api_groups_post_approve'),
    path('api/groups/posts/<int:post_id>/reject/', views.api_groups_post_reject, name='api_groups_post_reject'),
    path('api/groups/posts/<int:post_id>/delete/', views.api_groups_post_delete, name='api_groups_post_delete'),
    path('api/groups/posts/<int:post_id>/react/', views.api_groups_post_react, name='api_groups_post_react'),
    path('api/groups/posts/<int:post_id>/comments/', views.api_groups_post_comments, name='api_groups_post_comments'),
    path('api/groups/posts/<int:post_id>/comments/add/', views.api_groups_post_comment_add, name='api_groups_post_comment_add'),
    path('api/groups/posts/comments/<int:comment_id>/delete/', views.api_groups_post_comment_delete, name='api_groups_post_comment_delete'),
    path('api/groups/posts/<int:post_id>/edit/', views.api_groups_post_edit, name='api_groups_post_edit'),

    # Pages
    path('pages/', views.pages_view, name='pages'),
    path('pages/<int:page_id>/', views.page_view_view, name='page_view'),
    path('api/pages/list/', views.api_pages_list, name='api_pages_list'),
    path('api/pages/create/', views.api_pages_create, name='api_pages_create'),
    path('api/pages/<int:page_id>/edit/', views.api_pages_edit, name='api_pages_edit'),
    path('api/pages/<int:page_id>/delete/', views.api_pages_delete, name='api_pages_delete'),
    path('api/pages/<int:page_id>/toggle-follow/', views.api_pages_toggle_follow, name='api_pages_toggle_follow'),
    path('api/pages/<int:page_id>/update/', views.api_page_update, name='api_page_update'),
    path('api/pages/<int:page_id>/posts/', views.api_page_posts_list, name='api_page_posts_list'),
    path('api/pages/<int:page_id>/posts/create/', views.api_page_post_create, name='api_page_post_create'),
    path('api/pages/posts/<int:post_id>/delete/', views.api_page_post_delete, name='api_page_post_delete'),
    path('api/pages/posts/<int:post_id>/react/', views.api_page_post_react, name='api_page_post_react'),
    path('api/pages/posts/<int:post_id>/view/', views.api_page_post_view, name='api_page_post_view'),
    path('api/pages/posts/<int:post_id>/comments/', views.api_page_comments_list, name='api_page_comments_list'),
    path('api/pages/posts/<int:post_id>/comments/add/', views.api_page_comment_add, name='api_page_comment_add'),
    path('api/pages/comments/<int:comment_id>/delete/', views.api_page_comment_delete, name='api_page_comment_delete'),
    path('api/pages/<int:page_id>/followers/', views.api_page_followers_list, name='api_page_followers_list'),

    # Page Inbox (Task 17)
    path('pages/inbox/', views.page_inbox_view, name='page_inbox'),
    path('api/pages/conversations/', views.api_page_conversations, name='api_page_conversations'),
    path('api/pages/messages/', views.api_page_messages, name='api_page_messages'),
    path('api/pages/messages/start/', views.api_page_start_conversation, name='api_page_start_conversation'),
    path('api/pages/messages/send/', views.api_page_send_message, name='api_page_send_message'),
    path('api/pages/messages/read/', views.api_page_mark_read, name='api_page_mark_read'),
    path('api/page-posts/', views.api_page_posts_feed, name='api_page_posts_feed'),

    # Direct Messages (Task 18 Phase 1 & 2)
    path('chat/', views.chat_view, name='chat'),
    path('chat/<int:friend_id>/', views.chat_view, name='chat_with'),
    path('api/chat/conversations/', views.api_chat_conversations, name='api_chat_conversations'),
    path('api/chat/messages/', views.api_chat_messages, name='api_chat_messages'),
    path('api/chat/send/', views.api_chat_send, name='api_chat_send'),
    path('api/chat/read/', views.api_chat_mark_read, name='api_chat_mark_read'),
    path('api/chat/upload/', views.api_chat_upload, name='api_chat_upload'),
    path('api/chat/typing/', views.api_chat_typing, name='api_chat_typing'),
    path('api/chat/react/', views.api_chat_react, name='api_chat_react'),
    path('api/chat/edit/', views.api_chat_edit, name='api_chat_edit'),
    path('api/chat/delete/', views.api_chat_delete, name='api_chat_delete'),

    # Chat Rooms Directory & Management (Task 18 Phase 3)
    path('chatrooms/', views.chatrooms_view, name='chatrooms'),
    path('chatrooms/<int:room_id>/', views.chatroom_view, name='chatroom_view'),
    path('api/chatrooms/list/', views.api_chatrooms_list, name='api_chatrooms_list'),
    path('api/chatrooms/create/', views.api_chatrooms_create, name='api_chatrooms_create'),
    path('api/chatrooms/<int:room_id>/edit/', views.api_chatrooms_edit, name='api_chatrooms_edit'),
    path('api/chatrooms/<int:room_id>/delete/', views.api_chatrooms_delete, name='api_chatrooms_delete'),
    path('api/chatrooms/<int:room_id>/join/', views.api_chatrooms_join, name='api_chatrooms_join'),
    path('api/chatrooms/<int:room_id>/join-private/', views.api_chatrooms_join_private, name='api_chatrooms_join_private'),
    path('api/chatrooms/<int:room_id>/exit/', views.api_chatrooms_exit, name='api_chatrooms_exit'),
    path('api/chatrooms/check-name/', views.api_chatrooms_check_name, name='api_chatrooms_check_name'),

    # Chat Room Messaging & Moderation (Task 18 Phase 4)
    path('api/chatrooms/<int:room_id>/messages/', views.api_chatroom_messages, name='api_chatroom_messages'),
    path('api/chatrooms/<int:room_id>/messages/send/', views.api_chatroom_send, name='api_chatroom_send'),
    path('api/chatrooms/<int:room_id>/members/', views.api_chatroom_members, name='api_chatroom_members'),
    path('api/chatrooms/<int:room_id>/members/<int:uid>/remove/', views.api_chatroom_kick, name='api_chatroom_kick'),
    path('api/chatrooms/<int:room_id>/messages/<int:mid>/edit/', views.api_chatroom_edit_msg, name='api_chatroom_edit_msg'),
    path('api/chatrooms/<int:room_id>/messages/<int:mid>/delete/', views.api_chatroom_delete_msg, name='api_chatroom_delete_msg'),
    path('api/chatrooms/<int:room_id>/messages/<int:mid>/report/', views.api_chatroom_report, name='api_chatroom_report'),
    path('api/chatrooms/<int:room_id>/clear/', views.api_chatroom_clear, name='api_chatroom_clear'),

    # Chat Roulette (Task 19 Phase 1)
    path('roulette/', views.roulette_view, name='roulette'),
    path('api/roulette/active/', views.api_roulette_active, name='api_roulette_active'),
    path('api/roulette/join/', views.api_roulette_join, name='api_roulette_join'),
    path('api/roulette/poll/', views.api_roulette_poll, name='api_roulette_poll'),
    path('api/roulette/send/', views.api_roulette_send, name='api_roulette_send'),
    path('api/roulette/leave/', views.api_roulette_leave, name='api_roulette_leave'),
    path('api/roulette/next/', views.api_roulette_next, name='api_roulette_next'),
    path('api/roulette/heartbeat/', views.api_roulette_heartbeat, name='api_roulette_heartbeat'),
    path('api/roulette/report/', views.api_roulette_report, name='api_roulette_report'),

    # Games Hub (Task 22 Phase 1, 2, 3)
    path('games/', views.games_view, name='games'),
    path('games/spaceshooter/', views.space_view, name='game_spaceshooter'),
    path('games/lovemeter/', views.love_view, name='game_lovemeter'),
    path('games/catchme/', views.catch_view, name='game_catchme'),
    path('games/tictactoe/', views.tictactoe_view, name='game_tictactoe'),
    path('games/snake/', views.snake_view, name='game_snake'),
    path('games/airhockey/', views.airhockey_view, name='game_airhockey'),
    path('games/checkers/', views.checkers_view, name='game_checkers'),
    path('games/ludo/', views.ludo_view, name='game_ludo'),
    path('api/games/tictactoe/room/', views.api_tictactoe_room, name='api_tictactoe_room'),
    path('api/games/checkers/room/', views.api_checkers_room, name='api_checkers_room'),
    path('api/games/hub/', views.api_games_hub, name='api_games_hub'),
    path('api/games/leaderboard/', views.api_games_leaderboard, name='api_games_leaderboard'),
    path('api/games/track-play/', views.api_games_track_play, name='api_games_track_play'),
    path('api/games/save-score/', views.api_games_save_score, name='api_games_save_score'),
    path('api/games/invite/', views.api_games_invite, name='api_games_invite'),
    path('api/games/friends/', views.api_games_friends, name='api_games_friends'),

    # Store / Marketplace
    path('store/', views.store_view, name='store'),
    path('store/<str:ad_id>/', views.product_detail_view, name='product_detail'),
    path('api/store/create/', views.api_store_create_product, name='api_store_create_product'),
    path('api/store/mark-sold/<int:product_id>/', views.api_store_mark_sold, name='api_store_mark_sold'),
    path('api/store/delete/<int:product_id>/', views.api_store_delete_product, name='api_store_delete_product'),
    path('api/store/product/<str:identifier>/sold/', views.api_store_mark_sold, name='api_store_product_sold'),
    path('api/store/product/<str:identifier>/delete/', views.api_store_delete_product, name='api_store_product_delete'),

    # Admin Portal (Task 23 Phase 1)
    path('portal-admin/', admin_views.admin_login_view, name='portal_admin_root'),
    path('portal-admin/login/', admin_views.admin_login_view, name='portal_admin_login'),
    path('portal-admin/logout/', admin_views.admin_logout, name='portal_admin_logout'),
    path('portal-admin/dashboard/', admin_views.admin_dashboard, name='portal_admin_dashboard'),
    path('portal-admin/api/metrics/', admin_views.api_admin_metrics, name='portal_admin_api_metrics'),
    path('portal-admin/support/', admin_views.admin_support_view, name='portal_admin_support'),
    path('portal-admin/api/support/', admin_views.api_admin_support, name='portal_admin_api_support'),
    path('portal-admin/users/', admin_views.admin_users_view, name='portal_admin_users'),
    path('portal-admin/profile/', admin_views.admin_profile_settings_view, name='portal_admin_profile'),
    path('portal-admin/settings/', admin_views.admin_profile_settings_view, name='portal_admin_settings'),
    path('portal-admin/reports/', admin_views.admin_reports_view, name='portal_admin_reports'),
    path('portal-admin/logs/', admin_views.admin_logs_view, name='portal_admin_logs'),
    path('portal-admin/store/', admin_views.admin_store_view, name='portal_admin_store'),
    path('portal-admin/store/approve/<int:product_id>/', admin_views.admin_store_approve_view, name='portal_admin_store_approve'),
    path('portal-admin/store/reject/<int:product_id>/', admin_views.admin_store_reject_view, name='portal_admin_store_reject'),
    path('portal-admin/store/delete/<int:product_id>/', admin_views.admin_store_delete_view, name='portal_admin_store_delete'),

    # Web Push & Service Worker
    path('firebase-messaging-sw.js', views.serve_firebase_sw, name='serve_firebase_sw'),
    path('api/save-push-subscription/', views.api_save_push_subscription, name='api_save_push_subscription'),
    path('404/', views.error_404_view, name='error_404_preview'),

   
]
