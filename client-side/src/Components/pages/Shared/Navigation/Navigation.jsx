import {
  Navbar,
  Collapse,
  Typography,
  IconButton,
  Button,
  Menu,
  MenuHandler,
  MenuList,
  MenuItem,
  Avatar,
  Badge,
  Tooltip,
} from "@material-tailwind/react";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import React, { useContext, useEffect, useState } from "react";
import logo from "../../../../assets/logo.png";
import { NavLink, useNavigate } from "react-router-dom";
import { AuthContext } from "../../../providers/AuthProvider";
import Swal from "sweetalert2";

import {
  ChevronDownIcon,
  Cog6ToothIcon,
  PowerIcon,
  LifebuoyIcon,
} from "@heroicons/react/24/solid";
import useCart from "../../../hooks/useCart";
import useAdmin from "../../../hooks/useAdmin";
import useSeller from "../../../hooks/useSeller";
function ProfileMenu() {
  const [isAdmin] = useAdmin();
  const [isSeller] = useSeller();
  const profileMenuItems = [
    {
      label: "Edit Profile",
      icon: Cog6ToothIcon,
      onClick: (navigate) => navigate("/edit-profile"),
    },
    {
      label: "Dashboard",
      icon: LifebuoyIcon,
      onClick: () => {
        if (isAdmin) {
          navigate("/dashboard/adminHome");
        } else if (isSeller) {
          navigate("/dashboard/sellerHome");
        } else {
          navigate("dashboard/user/paymentHistory");
        }
      },
    },
    {
      label: "Sign Out",
      icon: PowerIcon,
      onClick: null, // onClick will be handled by handleLogOut
    },
  ];
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const closeMenu = () => setIsMenuOpen(false);
  const navigate = useNavigate();
  const { user, logOut } = useContext(AuthContext);

  const handleLogOut = () => {
    logOut()
      .then(() => {
        Swal.fire({
          position: "top-end",
          icon: "success",
          title: "You have been logged out",
          showConfirmButton: false,
          timer: 1500,
        }).then(() => {
          navigate("/");
        });
      })
      .catch((e) => {
        console.log(e);
      });
  };

  const handleMenuItemClick = (menuItem) => {
    if (menuItem.onClick) {
      menuItem.onClick(navigate);
    } else if (menuItem.label === "Sign Out") {
      handleLogOut();
    } else {
      closeMenu();
    }
  };

  return (
    <Tooltip content={user.displayName}>
      <Menu open={isMenuOpen} handler={setIsMenuOpen} placement="bottom-end">
        <MenuHandler>
          <Button
            variant="text"
            color="blue-gray"
            className="flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 lg:ml-auto"
          >
            <Avatar
              variant="circular"
              size="sm"
              alt="tania andrew"
              className="border border-gray-900 p-0.5"
              src={user.photoURL}
            />
            <ChevronDownIcon
              strokeWidth={2.5}
              className={`h-3 w-3 transition-transform ${
                isMenuOpen ? "rotate-180" : ""
              }`}
            />
          </Button>
        </MenuHandler>
        <MenuList className="p-1">
          {profileMenuItems.map((menuItem, key) => {
            const isLastItem = key === profileMenuItems.length - 1;
            return (
              <MenuItem
                key={menuItem.label}
                onClick={() => handleMenuItemClick(menuItem)}
                className={`flex items-center gap-2 rounded ${
                  isLastItem
                    ? "hover:bg-red-500/10 focus:bg-red-500/10 active:bg-red-500/10"
                    : ""
                }`}
              >
                {React.createElement(menuItem.icon, {
                  className: `h-4 w-4 ${isLastItem ? "text-red-500" : ""}`,
                  strokeWidth: 2,
                })}
                <Typography
                  as="span"
                  variant="medium"
                  className="font-normal"
                  color={isLastItem ? "red" : "inherit"}
                >
                  {menuItem.label}
                </Typography>
              </MenuItem>
            );
          })}
        </MenuList>
      </Menu>
    </Tooltip>
  );
}

function NavList() {
  const { user } = useContext(AuthContext);
  const [cart] = useCart();

  return (
    <ul className="my-2 flex flex-col gap-2 lg:mb-0 lg:mt-0 lg:flex-row lg:items-center lg:gap-6">
      <Typography
        as="li"
        variant="medium"
        color="blue-gray"
        className="p-1 font-bold"
      >
        <NavLink
          to="/"
          className={({ isActive }) =>
            isActive
              ? "flex items-center text-[#3DBDEC] transition-colors"
              : "flex items-center hover:text-[#3DBDEC] transition-colors"
          }
        >
          Home
        </NavLink>
      </Typography>

      <Typography
        as="li"
        variant="medium"
        color="blue-gray"
        className="p-1 font-bold"
      >
        <NavLink
          to="/shop"
          className={({ isActive }) =>
            isActive
              ? "flex items-center text-[#3DBDEC] transition-colors"
              : "flex items-center hover:text-[#3DBDEC] transition-colors"
          }
        >
          Shop
        </NavLink>
      </Typography>

      <Typography
        as="li"
        variant="medium"
        color="blue-gray"
        className="p-1 font-bold"
      >
        <NavLink to={"/cart"}>
          <Badge content={`${cart.length}`}>
            <IconButton className="bg-[#3DBDEC]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="size-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
                />
              </svg>
            </IconButton>
          </Badge>
        </NavLink>
      </Typography>

      {user ? (
        <ProfileMenu />
      ) : (
        <Typography
          as="li"
          variant="medium"
          color="blue-gray"
          className="p-1 font-bold"
        >
          <NavLink
            to="/login"
            className={({ isActive }) =>
              isActive
                ? "flex items-center text-[#3DBDEC] transition-colors"
                : "flex items-center hover:text-[#3DBDEC] transition-colors"
            }
          >
            <Button className="bg-[#3DBDEC] hover:bg-[#05a8e3]">Join Us</Button>
          </NavLink>
        </Typography>
      )}
    </ul>
  );
}

const Navigation = () => {
  const [openNav, setOpenNav] = useState(false);

  const handleWindowResize = () =>
    window.innerWidth >= 960 && setOpenNav(false);

  useEffect(() => {
    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  return (
    <Navbar className="mx-auto min-w-full px-6 py-3">
      <div className="flex items-center justify-between text-blue-gray-900 ">
        <div>
          <img src={logo} alt="Logo" className="h-10 lg:h-12" />
        </div>
        <div className="hidden lg:block">
          <NavList />
        </div>
        <IconButton
          variant="text"
          className="ml-auto  h-6 w-6 text-inherit hover:bg-transparent focus:bg-transparent active:bg-transparent lg:hidden"
          ripple={false}
          onClick={() => setOpenNav(!openNav)}
        >
          {openNav ? (
            <XMarkIcon className="h-6 w-6 text-[#3DBDEC]" strokeWidth={2} />
          ) : (
            <Bars3Icon className="h-6 w-6 text-[#3DBDEC]" strokeWidth={2} />
          )}
        </IconButton>
      </div>
      <Collapse open={openNav}>
        <NavList />
      </Collapse>
    </Navbar>
  );
};

export default Navigation;
