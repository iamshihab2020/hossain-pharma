import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import {
  Card,
  CardBody,
  Input,
  Button,
  Typography,
} from "@material-tailwind/react";
import SectionTittle from "../../Shared/SectionTittle/SectionTittle";
import { AuthContext } from "../../../providers/AuthProvider";

const EditProfile = () => {
  const { user, updateUserProfile } = useContext(AuthContext);
  const [name, setName] = useState(user?.displayName || "");
  const [photo, setPhoto] = useState(user?.photoURL || "");
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await updateUserProfile(name, photo);
      Swal.fire({
        position: "top-end",
        icon: "success",
        title: "Profile updated successfully",
        showConfirmButton: false,
        timer: 1500,
      });
      navigate("/");
    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "Oops...",
        text: error.message,
      });
    }
  };

  return (
    <div className="flex flex-col items-center min-h-screen">
      <SectionTittle title="Edit Profile" />
      <Card className="w-full max-w-lg mt-6">
        <CardBody>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <Typography variant="h6" color="gray">
                Name
              </Typography>
              <Input
                type="text"
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="mb-4">
              <Typography variant="h6" color="gray">
                Email
              </Typography>
              <Input type="email" label="Email" value={user.email} disabled />
            </div>
            <div className="mb-4">
              <Typography variant="h6" color="gray">
                Photo URL
              </Typography>
              <Input
                type="text"
                label="Photo URL"
                value={photo}
                onChange={(e) => setPhoto(e.target.value)}
              />
            </div>

            <Button type="submit" color="blue" className="w-full py-2">
              Save
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
};

export default EditProfile;
