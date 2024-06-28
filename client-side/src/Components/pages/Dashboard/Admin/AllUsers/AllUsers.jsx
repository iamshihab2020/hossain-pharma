
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Avatar,
  Typography,
  Tooltip,
  Chip,
} from "@material-tailwind/react";
import Swal from "sweetalert2";
import useAxiosSecure from "../../../../hooks/useAxiosSecure";
import Dash_Navbar from "../../../../layout/Dashboard/Dash_Navbar/Dash_Navbar";
import SyncHelmet from "../../../Shared/Helmet/SyncHelmet"
const AllUsers = () => {


  const axiosSecure = useAxiosSecure();
  const { data: users = [], refetch } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await axiosSecure.get("/users");
      return res.data;
    },
  });

  const handleDeleteUser = (user) => {
    Swal.fire({
      title: "Are you sure?",
      text: "You won't be able to revert this!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Yes, delete it!",
    }).then((result) => {
      if (result.isConfirmed) {
        axiosSecure.delete(`/users/${user._id}`).then((res) => {
          if (res.data.deletedCount > 0) {
            refetch();
            Swal.fire({
              title: "Deleted!",
              text: "This user has been deleted.",
              icon: "success",
              confirmButtonColor: "#3085d6",
            });
          }
        });
      }
    });
  };

  const handleRole = (user, role) => {
    Swal.fire({
      title: "Are you sure?",
      text: `You are about to change this user's role to ${role}.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Yes, do it!",
    }).then((result) => {
      if (result.isConfirmed) {
        axiosSecure.patch(`/users/${role}/${user._id}`).then((res) => {
          if (res.data.modifiedCount > 0) {
            refetch();
            Swal.fire({
              title: "Success!",
              text: `This user's role has been changed to ${role}.`,
              icon: "success",
              confirmButtonColor: "#3085d6",
            });
          }
        });
      }
    });
  };

  const TABLE_HEAD = [
    "No.",
    "Picture",
    "Name",
    "Email",
    "Select Role",
    "Delete",
  ];

  return (
    <>
      <SyncHelmet loc={"All User"}/>
      <Dash_Navbar title={"All Users"}/>
      <div className="flex justify-between p-5 rounded-xl mb-10 bg-[#1F2B5B] w-full">
        <Typography variant="h4" color="white" className="font-normal">
          Total Users:{" "}
          <span className="bg-red-500 px-4 py-2 rounded-full">
            {users.length}{" "}
          </span>
        </Typography>
      </div>

      <div className="pb-20">
        <Card className="h-full w-full overflow-scroll">
          <table className="w-full min-w-max table-auto text-left">
            <thead>
              <tr>
                {TABLE_HEAD.map((head) => (
                  <th
                    key={head}
                    className="border-b border-blue-gray-100 bg-[#3DBDEC] p-4"
                  >
                    <Typography
                      variant="lg"
                      className="font-bold text-white leading-none"
                    >
                      {head}
                    </Typography>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="border-b-2 border-[#3DBDEC]">
              {users.map((user, index) => (
                <tr key={user._id} className="even:bg-[#3DBDEC]">
                  <td className="p-4">
                    <Typography
                      variant="small"
                      className="font-normal text-[#1F2B5B]"
                    >
                      {index + 1}
                    </Typography>
                  </td>
                  <td className="p-2">
                    <Avatar
                      src={user.photoURL}
                      alt={`Avatar of ${user.name}`}
                    />
                  </td>
                  <td className="p-4">
                    <Typography
                      variant="small"
                      className="font-normal text-[#1F2B5B] flex items-center justify-start gap-x-2"
                    >
                      {user.name}
                      {user.role === "admin" ? (
                        <Chip
                          value={user.role}
                          size="sm"
                          color="red"
                          className="rounded-full"
                        />
                      ) : user.role === "seller" ? (
                        <Chip
                          value={user.role}
                          size="sm"
                          color="orange"
                          className="rounded-full"
                        />
                      ) : user.role === "user" || !user.role ? (
                        <Chip
                          value={user.role || "user"}
                          size="sm"
                          color="green"
                          className="rounded-full"
                        />
                      ) : null}
                    </Typography>
                  </td>
                  <td className="p-4">
                    <Typography
                      variant="small"
                      className="font-normal text-[#1F2B5B]"
                    >
                      {user.email}
                    </Typography>
                  </td>
                  <td className="p-4">
                    <Tooltip content={`Change role of ${user.name}`}>
                      <div className="flex gap-2">
                        {user.role !== "seller" && (
                          <Button
                            onClick={() => handleRole(user, "seller")}
                            size="sm"
                            className="bg-orange-500 rounded-full"
                          >
                            
                            Make Seller
                          </Button>
                        )}
                        {user.role !== "user" && (
                          <Button
                            onClick={() => handleRole(user, "user")}
                            size="sm"
                            className="bg-green-500 rounded-full"
                          >
                            Make User
                          </Button>
                        )}
                        {user.role !== "admin" && (
                          <Button
                            onClick={() => handleRole(user, "admin")}
                            size="sm"
                            className="bg-red-500 rounded-full"
                          >
                            Make Admin
                          </Button>
                        )}
                      </div>
                    </Tooltip>
                  </td>

                  <td className="p-4">
                    <Tooltip content="Delete this user">
                      <Button
                        onClick={() => handleDeleteUser(user)}
                        size="sm"
                        color="red"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                          className="size-4"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                          />
                        </svg>
                      </Button>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
};

export default AllUsers;
