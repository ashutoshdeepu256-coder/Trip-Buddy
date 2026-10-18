import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useNotificationStore } from '../../store/notificationStore'

export default function NotificationBell() {
  const unreadCount = useNotificationStore((state) => state.unreadCount)
  return <Link className="notification-bell" to="/notifications" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} title="Notifications">
    <Bell size={20} aria-hidden="true" />
    {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
  </Link>
}
